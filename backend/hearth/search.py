"""Search window titles, apps and websites across all history."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime

from .categories import IGNORED_APPS, app_key
from .db import Event, Store
from .summary import WEB_TYPE, Reader, _intersect, _merge_intervals, domain_of

MAX_EVENTS = 60_000


def _like_needle(q: str) -> str:
    # Event data is stored as ASCII-escaped JSON, so search for the escaped form.
    return json.dumps(q, ensure_ascii=True)[1:-1]


def search(store: Store, reader: Reader, q: str) -> dict:
    reader.refresh()
    q = q.strip()
    needle = q.lower()
    hits: list[tuple[Event, dict, str]] = []
    for type_ in ("currentwindow", WEB_TYPE):
        for ev in store.search_events(type_, _like_needle(q), MAX_EVENTS):
            d = reader.privacy.apply(ev.data)
            if type_ == WEB_TYPE:
                if d.get("private"):
                    continue
                d = {"app": d.get("browser", "browser"), "title": d.get("title", ""), "domain": domain_of(d.get("url", ""))}
            app = d.get("app") or ""
            if app_key(app) in IGNORED_APPS:
                continue
            hay = f"{app}\n{d.get('title', '')}\n{d.get('domain', '')}".lower()
            if needle in hay:  # the SQL match was a prefilter on the raw JSON
                hits.append((ev, d, type_))

    if not hits:
        return {"query": q, "total": 0, "results": [], "apps": [], "truncated": False, "colors": reader.colors}

    lo = min(e.start for e, _, _ in hits)
    hi = max(e.end for e, _, _ in hits)
    active = _merge_intervals([(a.start, a.end, {}) for a in store.events_of_type("afkstatus", lo, hi + 1)
                               if a.data.get("status") == "not-afk"])

    groups: dict[tuple[str, str, str], dict] = {}
    apps: dict[str, float] = defaultdict(float)
    hits.sort(key=lambda h: h[0].start)
    for ev, d, _ in hits:
        pieces = _intersect([(ev.start, ev.end, d)], active) if active else [(ev.start, ev.end, d)]
        sec = sum(e - s for s, e, _ in pieces)
        if sec <= 0:
            continue
        key = (d.get("app", ""), d.get("title", ""), d.get("domain", ""))
        g = groups.setdefault(key, {"seconds": 0.0, "first": ev.start, "last": ev.end, "days": defaultdict(float)})
        g["seconds"] += sec
        g["first"] = min(g["first"], ev.start)
        g["last"] = max(g["last"], ev.end)
        g["days"][datetime.fromtimestamp(ev.start).date().isoformat()] += sec
        apps[key[0]] += sec

    results = []
    for (app, title, domain), g in sorted(groups.items(), key=lambda kv: -kv[1]["seconds"])[:60]:
        days = sorted(g["days"].items(), reverse=True)
        results.append({
            "app": app, "title": title, "domain": domain,
            "category": reader.categorize(app, title, domain),
            "seconds": g["seconds"], "first": g["first"], "last": g["last"],
            "day_count": len(days), "days": [{"date": k, "seconds": v} for k, v in days[:40]],
        })
    return {
        "query": q,
        "total": sum(apps.values()),
        "results": results,
        "apps": [{"app": a, "seconds": s, "category": reader.categorize(a, "", "")}
                 for a, s in sorted(apps.items(), key=lambda kv: -kv[1])[:10]],
        "truncated": len(hits) >= MAX_EVENTS,
        "colors": reader.colors,
    }
