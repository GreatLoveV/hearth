"""Daily goals and limits, and the notifications they raise."""

from __future__ import annotations

from datetime import date

from .categories import app_key
from .settings import Goal, Settings
from .summary import Reader, aggregate, day_bounds

NEAR = 0.8


def goal_status(reader: Reader, settings: Settings, day: date) -> list[dict]:
    goals = settings.goals.goals
    if not goals:
        return []
    ds, de = day_bounds(day)
    agg = aggregate(reader.spans(ds, de))
    cats = {c["name"]: c["seconds"] for c in agg["categories"]}
    apps: dict[str, float] = {}
    for a in agg["apps"]:
        apps[app_key(a["app"])] = apps.get(app_key(a["app"]), 0) + a["seconds"]

    out = []
    for g in goals:
        seconds = cats.get(g.name, 0.0) if g.scope == "category" else apps.get(app_key(g.name), 0.0)
        ratio = seconds / (g.minutes * 60)
        if day.weekday() not in g.days:
            state = "off"
        elif g.kind == "limit":
            state = "over" if ratio >= 1 else "near" if ratio >= NEAR else "ok"
        else:
            state = "done" if ratio >= 1 else "pending"
        out.append({**g.model_dump(), "seconds": seconds, "ratio": ratio, "state": state})
    return out


def _label(g: dict) -> str:
    return g["name"] if g["scope"] == "category" else g["name"].removesuffix(".exe")


def _fmt(minutes: float) -> str:
    h, m = divmod(round(minutes), 60)
    return f"{h}h {m:02d}m" if h else f"{m}m"


class Notifier:
    """Works out which goal messages are new today. Sent keys are stored, so restarts don't repeat them."""

    def __init__(self, reader: Reader, settings: Settings):
        self.reader = reader
        self.settings = settings

    def due(self, today: date) -> list[tuple[str, str]]:
        store = self.settings.store
        sent = store.get_setting("_notified", {})
        if sent.get("date") != today.isoformat():
            sent = {"date": today.isoformat(), "keys": []}
        messages = []
        for g in goal_status(self.reader, self.settings, today):
            key = f"{g['id']}:{g['state']}"
            if g["state"] not in ("near", "over", "done") or key in sent["keys"]:
                continue
            sent["keys"].append(key)
            name, limit = _label(g), _fmt(g["minutes"])
            if g["state"] == "near":
                messages.append(("Close to your limit", f"{name}: {_fmt(g['seconds'] / 60)} of your {limit} today."))
            elif g["state"] == "over":
                messages.append(("Daily limit reached", f"You've spent {_fmt(g['seconds'] / 60)} on {name} today. Your limit is {limit}."))
            else:
                messages.append(("Goal reached", f"{limit} of {name} today. Nice work."))
        store.set_setting("_notified", sent)
        return messages


__all__ = ["Goal", "Notifier", "goal_status"]
