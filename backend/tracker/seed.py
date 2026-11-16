"""Fill a database with realistic sample days, for trying the UI without waiting.

    python -m tracker.seed --db demo.db
    python -m tracker --db demo.db --no-watchers

Never point this at your real database: it adds made-up activity.
"""

from __future__ import annotations

import argparse
import random
import time
from datetime import datetime, timedelta
from pathlib import Path

from .db import Store

APPS: list[tuple[str, list[str], float]] = [
    ("Code.exe", [
        "summary.py - tracker - Visual Studio Code",
        "App.tsx - tracker - Visual Studio Code",
        "DayDial.tsx - tracker - Visual Studio Code",
        "styles.css - tracker - Visual Studio Code",
    ], 9),
    ("chrome.exe", [
        "activitywatch/activitywatch - GitHub - Google Chrome",
        "python - sqlite3 WAL mode - Stack Overflow - Google Chrome",
        "Inbox (3) - Gmail - Google Chrome",
        "lofi hip hop radio - YouTube - Google Chrome",
        "FastAPI - Tutorial - Google Chrome",
        "Hacker News - Google Chrome",
    ], 7),
    ("WindowsTerminal.exe", ["PowerShell", "npm run dev", "python -m tracker"], 4),
    ("slack.exe", ["Slack | design-review", "Slack | general", "Slack | Direct messages"], 3),
    ("Figma.exe", ["Tracker dashboard - Figma", "Icons - Figma"], 2),
    ("Spotify.exe", ["Spotify Premium", "Focus Flow - Spotify"], 1),
    ("WINWORD.EXE", ["Q4 plan.docx - Word"], 1),
    ("explorer.exe", ["Downloads", "tracker"], 1),
]


def seed_day(store: Store, win: str, afk: str, day: datetime, until: float, rng: random.Random) -> None:
    t = (day + timedelta(hours=8, minutes=rng.randint(20, 70))).timestamp()
    end = min((day + timedelta(hours=18, minutes=rng.randint(0, 80))).timestamp(), until)
    lunch = (day + timedelta(hours=12, minutes=rng.randint(15, 50))).timestamp()
    had_lunch = False
    names = [a[0] for a in APPS]
    weights = [a[2] for a in APPS]

    while t < end:
        if not had_lunch and t >= lunch:
            gap = rng.randint(35, 60) * 60
            store.insert_event(afk, t, gap, {"status": "afk"})
            t += gap
            had_lunch = True
            continue
        if rng.random() < 0.05:
            gap = rng.randint(4, 15) * 60
            store.insert_event(afk, t, gap, {"status": "afk"})
            t += gap
            continue

        session_end = min(t + rng.randint(20, 75) * 60, end)
        store.insert_event(afk, t, session_end - t, {"status": "not-afk"})
        while t < session_end:
            name = rng.choices(names, weights)[0]
            titles = next(a[1] for a in APPS if a[0] == name)
            dur = min(rng.lognormvariate(5.6, 1.0), 40 * 60, session_end - t)
            dur = max(dur, 8)
            store.insert_event(win, t, dur, {"app": name, "title": rng.choice(titles)})
            t += dur


def main() -> None:
    parser = argparse.ArgumentParser(prog="tracker.seed")
    parser.add_argument("--db", type=Path, required=True)
    parser.add_argument("--days", type=int, default=7)
    args = parser.parse_args()

    store = Store(args.db)
    host = "demo-pc"
    win, afk = f"window_{host}", f"afk_{host}"
    store.ensure_bucket(win, "currentwindow", host)
    store.ensure_bucket(afk, "afkstatus", host)

    now = time.time()
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    for i in range(args.days - 1, -1, -1):
        day = today - timedelta(days=i)
        seed_day(store, win, afk, day, now, random.Random(day.toordinal()))
    print(f"Seeded {args.days} days into {store.path}")


if __name__ == "__main__":
    main()
