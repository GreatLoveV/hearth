"""Turn raw events into what the dashboard shows.

Reading history goes through one pipeline (`Reader.spans`):
window events -> privacy rules -> only time you were active -> browser tabs filled in -> categories.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from urllib.parse import urlsplit

from .categories import IGNORED_APPS, Categorizer, PrivacyFilter, app_key
from .db import Event, Store
from .settings import Settings

MERGE_GAP = 60  # seconds: same-app blocks closer than this join on the timeline
BROWSERS = {"firefox", "chrome", "msedge", "brave", "opera", "vivaldi", "arc"}
WEB_TYPE = "web.tab.current"

Raw = tuple[float, float, dict]


@dataclass(slots=True)
class Span:
    start: float
    end: float
    app: str
    title: str
    domain: str
    category: str


def _clip(events: list[Event], lo: float, hi: float) -> list[Raw]:
    out = []
    for e in events:
        s, t = max(e.start, lo), min(e.end, hi)
        if t > s:
            out.append((s, t, e.data))
    out.sort(key=lambda x: x[0])
    return out


def _merge_intervals(items: list[Raw]) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for s, e, _ in items:
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return [(a, b) for a, b in out]


def _intersect(spans: list[Raw], active: list[tuple[float, float]]) -> list[Raw]:
    out: list[Raw] = []
    j = 0
    for s, e, d in spans:
        while j < len(active) and active[j][1] <= s:
            j += 1
        k = j
        while k < len(active) and active[k][0] < e:
            cs, ce = max(s, active[k][0]), min(e, active[k][1])
            if ce > cs:
                out.append((cs, ce, d))
            k += 1
    return out


def domain_of(url: str) -> str:
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _with_tabs(spans: list[Raw], web: list[Raw]) -> list[Raw]:
    """Split browser window time by the tab that was active, so titles and domains are real."""
    if not web:
        return spans
    out: list[Raw] = []
    j = 0
    for s, e, d in spans:
        browser = app_key(d.get("app", ""))
        if browser not in BROWSERS:
            out.append((s, e, d))
            continue
        while j < len(web) and web[j][1] <= s:
            j += 1
        t = s
        i = j
        while i < len(web) and web[i][0] < e:
            ws, we, wd = web[i]
            i += 1
            if wd.get("browser", browser) != browser:
                continue
            if ws > t:
                out.append((t, min(ws, e), d))
            cs, ce = max(t, ws), min(e, we)
            if ce > cs:
                tab = dict(d)
                if wd.get("private"):
                    tab.update(title="", private=True)
                else:
                    tab.update(title=wd.get("title") or d.get("title", ""), domain=domain_of(wd.get("url", "")))
                out.append((cs, ce, tab))
            t = max(t, ce)
        if t < e:
            out.append((t, e, d))
    return out


class Reader:
    def __init__(self, store: Store, settings: Settings):
        self.store = store
        self.settings = settings
        self._rev = -1
        self.categorize: Categorizer
        self.privacy: PrivacyFilter

    def refresh(self) -> None:
        rev = self.store.revision()
        if rev != self._rev:
            self.categorize = Categorizer(self.settings.categories)
            self.privacy = PrivacyFilter(self.settings.privacy)
            self._rev = rev

    @property
    def colors(self) -> dict[str, str]:
        self.refresh()
        return self.categorize.colors

    def spans(self, start: float, end: float) -> list[Span]:
        self.refresh()
        window = _clip(self.store.events_of_type("currentwindow", start, end), start, end)
        window = [(s, e, d) for s, e, d in window if app_key(d.get("app", "")) not in IGNORED_APPS]

        afk = self.store.events_of_type("afkstatus", start, end)
        if afk:
            active = _merge_intervals(_clip([a for a in afk if a.data.get("status") == "not-afk"], start, end))
            window = _intersect(window, active)

        web = _clip(self.store.events_of_type(WEB_TYPE, start, end), start, end)
        window = _with_tabs(window, web)

        out = []
        for s, e, d in window:
            d = self.privacy.apply(d)
            app = d.get("app") or "unknown"
            title = d.get("title") or ""
            domain = d.get("domain") or ""
            out.append(Span(s, e, app, title, domain, self.categorize(app, title, domain)))
        return out


def _hour_slots(s: float, e: float):
    """Yield (local hour 0-23, seconds) pieces of [s, e)."""
    t = s
    while t < e:
        dt = datetime.fromtimestamp(t)
        nxt = (dt.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).timestamp()
        piece = min(e, nxt) - t
        yield dt.hour, piece
        t += piece


def aggregate(spans: list[Span]) -> dict:
    apps: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    titles: dict[tuple[str, str], float] = defaultdict(float)
    cats: dict[str, float] = defaultdict(float)
    sites: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    hours = [0.0] * 24
    timeline: list[dict] = []

    for sp in spans:
        dur = sp.end - sp.start
        apps[sp.app][sp.category] += dur
        cats[sp.category] += dur
        if sp.title:
            titles[(sp.app, sp.title)] += dur
        if sp.domain:
            sites[sp.domain][sp.category] += dur
        for h, sec in _hour_slots(sp.start, sp.end):
            hours[h] += sec
        last = timeline[-1] if timeline else None
        if last and last["app"] == sp.app and last["category"] == sp.category and sp.start - last["end"] <= MERGE_GAP:
            last["end"] = max(last["end"], sp.end)
        else:
            timeline.append(
                {"start": sp.start, "end": sp.end, "app": sp.app, "category": sp.category,
                 "title": sp.title, "domain": sp.domain}
            )

    def ranked(d: dict[str, dict[str, float]], key: str) -> list[dict]:
        rows = [
            {key: k, "seconds": sum(v.values()), "category": max(v.items(), key=lambda kv: kv[1])[0]}
            for k, v in d.items()
        ]
        return sorted(rows, key=lambda r: -r["seconds"])

    longest = max(timeline, key=lambda b: b["end"] - b["start"], default=None)
    return {
        "total": sum(cats.values()),
        "apps": ranked(apps, "app"),
        "sites": ranked(sites, "domain"),
        "titles": [
            {"app": a, "title": t, "seconds": sec}
            for (a, t), sec in sorted(titles.items(), key=lambda kv: -kv[1])[:15]
        ],
        "categories": [{"name": c, "seconds": s} for c, s in sorted(cats.items(), key=lambda kv: -kv[1])],
        "hours": hours,
        "timeline": timeline,
        "first": spans[0].start if spans else None,
        "last": spans[-1].end if spans else None,
        "longest": {"app": longest["app"], "seconds": longest["end"] - longest["start"]} if longest else None,
        "switches": max(0, len(timeline) - 1),
    }


def current_activity(store: Store, reader: Reader, now: float) -> dict | None:
    window = store.events_of_type("currentwindow", now - 120, now + 1)
    afk = store.events_of_type("afkstatus", now - 120, now + 1)
    if not window or not afk:
        return None
    w = max(window, key=lambda ev: ev.end)
    a = max(afk, key=lambda ev: ev.end)
    if now - w.end > 15 or a.data.get("status") != "not-afk" or now - a.end > 30:
        return None
    if app_key(w.data.get("app", "")) in IGNORED_APPS:
        return None
    reader.refresh()
    d = reader.privacy.apply(w.data)
    return {"app": d.get("app") or "unknown", "title": d.get("title", ""), "since": w.start}


def build_summary(store: Store, reader: Reader, start: float, end: float, now: float) -> dict:
    out = aggregate(reader.spans(start, end))
    out.update(start=start, end=end, colors=reader.colors)
    cur = current_activity(store, reader, now) if start <= now <= end else None
    if cur and out["timeline"] and out["timeline"][-1]["app"] == cur["app"]:
        cur["since"] = out["timeline"][-1]["start"]
    out["current"] = cur
    return out


# Ranges (week / month / year) ------------------------------------------------------


def day_bounds(d: date) -> tuple[float, float]:
    start = datetime(d.year, d.month, d.day)
    return start.timestamp(), (start + timedelta(days=1)).timestamp()


def _compact_day(spans: list[Span]) -> dict:
    agg = aggregate(spans)
    return {
        "total": agg["total"],
        "categories": {c["name"]: c["seconds"] for c in agg["categories"]},
        "apps": {a["app"]: [a["seconds"], a["category"]] for a in agg["apps"][:40]},
        "sites": {s["domain"]: [s["seconds"], s["category"]] for s in agg["sites"][:30]},
        "hours": agg["hours"],
        "first": agg["first"],
        "last": agg["last"],
    }


def days_data(store: Store, reader: Reader, days: list[date], now: float) -> dict[str, dict]:
    reader.refresh()
    rev = store.revision()
    keys = [d.isoformat() for d in days]
    have = store.cached_days(keys, rev)
    missing = [d for d in days if d.isoformat() not in have and day_bounds(d)[0] <= now]

    # Fetch contiguous runs of missing days with one query each.
    runs: list[list[date]] = []
    for d in missing:
        if runs and (d - runs[-1][-1]).days == 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    fresh: dict[str, dict] = {}
    for run in runs:
        lo, _ = day_bounds(run[0])
        _, hi = day_bounds(run[-1])
        spans = reader.spans(lo, hi)
        i = 0
        for d in run:
            ds, de = day_bounds(d)
            mine: list[Span] = []
            while i < len(spans) and spans[i].start < de:
                sp = spans[i]
                if sp.end > de:  # crosses midnight: split it
                    mine.append(Span(sp.start, de, sp.app, sp.title, sp.domain, sp.category))
                    spans[i] = Span(de, sp.end, sp.app, sp.title, sp.domain, sp.category)
                    break
                mine.append(sp)
                i += 1
            fresh[d.isoformat()] = _compact_day(mine)
        complete = {k: v for k, v in fresh.items() if day_bounds(date.fromisoformat(k))[1] <= now}
        store.cache_days(complete, rev)
    empty = _compact_day([])
    return {k: have.get(k) or fresh.get(k) or empty for k in keys}


def build_range(store: Store, reader: Reader, first: date, last: date, now: float) -> dict:
    n = (last - first).days + 1
    days = [first + timedelta(days=i) for i in range(n)]
    prev_days = [first - timedelta(days=n - i) for i in range(n)]
    data = days_data(store, reader, prev_days + days, now)

    apps: dict[str, list] = {}
    sites: dict[str, list] = {}
    cats: dict[str, float] = defaultdict(float)
    hours = [0.0] * 24
    weekday_total = [0.0] * 7
    weekday_count = [0] * 7
    out_days = []
    active_days = 0
    for d in days:
        v = data[d.isoformat()]
        out_days.append({"date": d.isoformat(), "total": v["total"], "categories": v["categories"],
                         "first": v["first"], "last": v["last"]})
        for name, sec in v["categories"].items():
            cats[name] += sec
        for app, (sec, cat) in v["apps"].items():
            row = apps.setdefault(app, [0.0, cat])
            row[0] += sec
        for dom, (sec, cat) in v["sites"].items():
            row = sites.setdefault(dom, [0.0, cat])
            row[0] += sec
        if v["total"] > 0:
            active_days += 1
            for h in range(24):
                hours[h] += v["hours"][h]
            weekday_total[d.weekday()] += v["total"]
            weekday_count[d.weekday()] += 1

    prev_cats: dict[str, float] = defaultdict(float)
    prev_total = 0.0
    for d in prev_days:
        v = data[d.isoformat()]
        prev_total += v["total"]
        for name, sec in v["categories"].items():
            prev_cats[name] += sec

    return {
        "start": first.isoformat(),
        "end": last.isoformat(),
        "colors": reader.colors,
        "total": sum(cats.values()),
        "active_days": active_days,
        "days": out_days,
        "categories": [{"name": c, "seconds": s} for c, s in sorted(cats.items(), key=lambda kv: -kv[1])],
        "apps": [{"app": a, "seconds": s, "category": c} for a, (s, c) in sorted(apps.items(), key=lambda kv: -kv[1][0])[:20]],
        "sites": [{"domain": a, "seconds": s, "category": c} for a, (s, c) in sorted(sites.items(), key=lambda kv: -kv[1][0])[:15]],
        "rhythm": [h / active_days if active_days else 0 for h in hours],
        "weekdays": [weekday_total[i] / weekday_count[i] if weekday_count[i] else 0 for i in range(7)],
        "previous": {"total": prev_total, "categories": dict(prev_cats)},
    }
