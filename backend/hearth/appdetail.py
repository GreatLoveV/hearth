"""One app, or one category, on its own: its days, hours, window titles, sites, sessions and
resource use.

Days are summarised per app (or per category) and cached in `app_day_cache` under the same
revision rule as `day_cache`. Categories are cached under `category:<name>`, which can't clash
with an app key. To keep the first visit quick, the shared day summaries are read first and only
the days on which the app or category actually appears are read in full.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Callable

from .categories import app_key
from .db import Store
from .resources import summarize
from .summary import MERGE_GAP, Reader, Span, _hour_slots, day_bounds, days_data

TOP_TITLES = 25
TOP_SITES = 15


def _app_day(spans: list[Span]) -> dict:
    hours = [0.0] * 24
    titles: dict[str, float] = defaultdict(float)
    sites: dict[str, float] = defaultdict(float)
    cats: dict[str, float] = defaultdict(float)
    apps: dict[str, float] = defaultdict(float)
    sessions: list[list[float]] = []
    for sp in spans:
        dur = sp.end - sp.start
        cats[sp.category] += dur
        apps[sp.app] += dur
        if sp.title:
            titles[sp.title] += dur
        if sp.domain:
            sites[sp.domain] += dur
        for h, sec in _hour_slots(sp.start, sp.end):
            hours[h] += sec
        if sessions and sp.start - sessions[-1][1] <= MERGE_GAP:
            sessions[-1][1] = max(sessions[-1][1], sp.end)
            sessions[-1][2] += dur
        else:
            sessions.append([sp.start, sp.end, dur])
    longest = max(sessions, key=lambda s: s[1] - s[0], default=None)
    top = lambda d, n: dict(sorted(d.items(), key=lambda kv: -kv[1])[:n])  # noqa: E731
    return {
        "total": sum(cats.values()),
        "hours": hours,
        "titles": top(titles, TOP_TITLES),
        "sites": top(sites, TOP_SITES),
        "categories": dict(cats),
        "apps": dict(apps),
        "first": spans[0].start if spans else None,
        "last": spans[-1].end if spans else None,
        "sessions": len(sessions),
        "longest": [longest[0], longest[1]] if longest else None,
    }


EMPTY = _app_day([])


def _filtered_days(
    store: Store,
    reader: Reader,
    cache_key: str,
    match: Callable[[Span], bool],
    used: Callable[[dict], bool],
    days: list[date],
    now: float,
    overview: dict,
) -> dict[str, dict]:
    """Per-day summaries of the spans that `match`, reading in full only the days `used` picks."""
    rev = store.revision()
    isos = [d.isoformat() for d in days]
    have = store.cached_app_days(cache_key, isos, rev)
    missing = [d for d in days if d.isoformat() not in have and day_bounds(d)[0] <= now and used(overview[d.isoformat()])]
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
        spans = [sp for sp in reader.spans(lo, hi) if match(sp)]
        i = 0
        for d in run:
            _, de = day_bounds(d)
            mine: list[Span] = []
            while i < len(spans) and spans[i].start < de:
                sp = spans[i]
                if sp.end > de:  # crosses midnight: split it
                    mine.append(Span(sp.start, de, sp.app, sp.title, sp.domain, sp.category))
                    spans[i] = Span(de, sp.end, sp.app, sp.title, sp.domain, sp.category)
                    break
                mine.append(sp)
                i += 1
            fresh[d.isoformat()] = _app_day(mine)
    complete = {k: v for k, v in fresh.items() if day_bounds(date.fromisoformat(k))[1] <= now}
    if complete:
        store.cache_app_days(cache_key, complete, rev)
    return {k: have.get(k) or fresh.get(k) or EMPTY for k in isos}


def app_days(store: Store, reader: Reader, key: str, days: list[date], now: float, overview: dict | None = None) -> dict[str, dict]:
    reader.refresh()
    if overview is None:
        overview = days_data(store, reader, days, now)
    return _filtered_days(
        store,
        reader,
        key,
        match=lambda sp: app_key(sp.app) == key,
        used=lambda day: any(app_key(a) == key for a in day["apps"]),
        days=days,
        now=now,
        overview=overview,
    )


def category_days(store: Store, reader: Reader, name: str, days: list[date], now: float, overview: dict) -> dict[str, dict]:
    reader.refresh()
    return _filtered_days(
        store,
        reader,
        f"category:{name}",
        match=lambda sp: sp.category == name,
        used=lambda day: day["categories"].get(name, 0) > 0,
        days=days,
        now=now,
        overview=overview,
    )


def build_app(store: Store, reader: Reader, app: str, first: date, last: date, now: float, every: float) -> dict:
    key = app_key(app)
    n = (last - first).days + 1
    days = [first + timedelta(days=i) for i in range(n)]
    overview = days_data(store, reader, days, now)
    data = app_days(store, reader, key, days, now, overview)

    hours = [0.0] * 24
    titles: dict[str, float] = defaultdict(float)
    sites: dict[str, float] = defaultdict(float)
    cats: dict[str, float] = defaultdict(float)
    out_days = []
    active = sessions = 0
    longest: tuple[float, float] | None = None
    for d in days:
        v = data[d.isoformat()]
        out_days.append({"date": d.isoformat(), "total": v["total"], "categories": v["categories"],
                         "first": v["first"], "last": v["last"]})
        if v["total"] <= 0:
            continue
        active += 1
        sessions += v["sessions"]
        for h in range(24):
            hours[h] += v["hours"][h]
        for t, s in v["titles"].items():
            titles[t] += s
        for t, s in v["sites"].items():
            sites[t] += s
        for c, s in v["categories"].items():
            cats[c] += s
        if v["longest"] and (not longest or v["longest"][1] - v["longest"][0] > longest[1] - longest[0]):
            longest = (v["longest"][0], v["longest"][1])

    # Share of all your time, and the period before, from the shared day summaries.
    everything = sum(v["total"] for v in overview.values())
    prev_days = [first - timedelta(days=n - i) for i in range(n)]
    prev = days_data(store, reader, prev_days, now)
    prev_total = sum(sec for v in prev.values() for a, (sec, _) in v["apps"].items() if app_key(a) == key)

    lo, _ = day_bounds(first)
    _, hi = day_bounds(last)
    use = summarize(store.usage(lo, hi, key), every).get(key)
    total = sum(cats.values())
    return {
        "app": app,
        "key": key,
        "start": first.isoformat(),
        "end": last.isoformat(),
        "colors": reader.colors,
        "category": max(cats.items(), key=lambda kv: kv[1])[0] if cats else reader.categorize(app, "", ""),
        "total": total,
        "share": total / everything if everything else 0.0,
        "active_days": active,
        "days": out_days,
        "rhythm": [h / active if active else 0 for h in hours],
        "titles": [{"title": t, "seconds": s} for t, s in sorted(titles.items(), key=lambda kv: -kv[1])[:TOP_TITLES]],
        "sites": [{"domain": t, "seconds": s} for t, s in sorted(sites.items(), key=lambda kv: -kv[1])[:TOP_SITES]],
        "categories": [{"name": c, "seconds": s} for c, s in sorted(cats.items(), key=lambda kv: -kv[1])],
        "sessions": sessions,
        "longest": {"start": longest[0], "seconds": longest[1] - longest[0]} if longest else None,
        "previous": prev_total,
        "first_seen": store.first_seen(key),
        "exe": store.exe_for(key),
        "resources": use,
    }


TOP_APPS = 40


def build_category(store: Store, reader: Reader, name: str, first: date, last: date, now: float) -> dict:
    n = (last - first).days + 1
    days = [first + timedelta(days=i) for i in range(n)]
    overview = days_data(store, reader, days, now)
    data = category_days(store, reader, name, days, now, overview)

    hours = [0.0] * 24
    titles: dict[str, float] = defaultdict(float)
    sites: dict[str, float] = defaultdict(float)
    apps: dict[str, list] = {}  # key -> [seconds, days used, display name]
    weekday_total = [0.0] * 7
    weekday_count = [0] * 7
    out_days = []
    active = sessions = 0
    longest: tuple[float, float] | None = None
    for d in days:
        v = data[d.isoformat()]
        out_days.append({"date": d.isoformat(), "total": v["total"], "categories": {name: v["total"]} if v["total"] else {},
                         "first": v["first"], "last": v["last"]})
        if day_bounds(d)[0] <= now:
            weekday_count[d.weekday()] += 1
        if v["total"] <= 0:
            continue
        active += 1
        sessions += v["sessions"]
        weekday_total[d.weekday()] += v["total"]
        for h in range(24):
            hours[h] += v["hours"][h]
        for t, sec in v["titles"].items():
            titles[t] += sec
        for t, sec in v["sites"].items():
            sites[t] += sec
        for a, sec in v.get("apps", {}).items():
            row = apps.setdefault(app_key(a), [0.0, 0, a])
            row[0] += sec
            row[1] += 1
        if v["longest"] and (not longest or v["longest"][1] - v["longest"][0] > longest[1] - longest[0]):
            longest = (v["longest"][0], v["longest"][1])

    everything = sum(v["total"] for v in overview.values())
    prev_days = [first - timedelta(days=n - i) for i in range(n)]
    prev = days_data(store, reader, prev_days, now)
    prev_total = sum(v["categories"].get(name, 0) for v in prev.values())

    total = sum(v["total"] for v in data.values())
    return {
        "name": name,
        "start": first.isoformat(),
        "end": last.isoformat(),
        "colors": reader.colors,
        "total": total,
        "share": total / everything if everything else 0.0,
        "everything": everything,
        "active_days": active,
        "days": out_days,
        "rhythm": [h / active if active else 0 for h in hours],
        "weekdays": [weekday_total[i] / weekday_count[i] if weekday_count[i] else 0 for i in range(7)],
        "apps": [
            {"app": a[2], "key": k, "seconds": a[0], "days": a[1]}
            for k, a in sorted(apps.items(), key=lambda kv: -kv[1][0])[:TOP_APPS]
        ],
        "app_count": len(apps),
        "titles": [{"title": t, "seconds": sec} for t, sec in sorted(titles.items(), key=lambda kv: -kv[1])[:TOP_TITLES]],
        "sites": [{"domain": t, "seconds": sec} for t, sec in sorted(sites.items(), key=lambda kv: -kv[1])[:TOP_SITES]],
        "sessions": sessions,
        "longest": {"start": longest[0], "seconds": longest[1] - longest[0]} if longest else None,
        "previous": prev_total,
    }
