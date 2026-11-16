"""Import history from a running ActivityWatch server.

    python -m tracker.import_aw                      # from http://127.0.0.1:5600
    python -m tracker.import_aw --aw-url http://127.0.0.1:5666

Imported events go into their own `aw-import-…` buckets and stop where Tracker's own
recording of the same type begins, so the same time is never counted twice.
Running it again replaces the earlier import.
"""

from __future__ import annotations

import argparse
import json
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .db import DEFAULT_DB, Store

PREFIX = "aw-import-"
CHUNK = timedelta(days=14)


def _get(base: str, path: str):
    with urllib.request.urlopen(f"{base}/api/0/{path}", timeout=120) as res:
        return json.load(res)


def _ts(s: str) -> float:
    return datetime.fromisoformat(s).timestamp()


def import_bucket(store: Store, base: str, aw_id: str, info: dict) -> tuple[str, int]:
    bucket_id = PREFIX + aw_id.removeprefix("aw-watcher-")
    store.ensure_bucket(bucket_id, info["type"], info.get("hostname", "unknown"))
    store.clear_bucket(bucket_id)
    cutoff = store.earliest_start(info["type"], PREFIX)

    created = datetime.fromisoformat(info["created"]) - timedelta(days=1)
    end = datetime.now(timezone.utc) + timedelta(days=1)
    total = 0
    t = created
    while t < end:
        q = urllib.parse.urlencode({"start": t.isoformat(), "end": (t + CHUNK).isoformat(), "limit": -1})
        rows = []
        for ev in _get(base, f"buckets/{urllib.parse.quote(aw_id)}/events?{q}"):
            s = _ts(ev["timestamp"])
            d = float(ev["duration"])
            if cutoff is not None:
                if s >= cutoff:
                    continue
                d = min(d, cutoff - s)
            # Events straddling a chunk edge come back twice; keep the copy from the chunk it starts in.
            if not (t.timestamp() <= s < (t + CHUNK).timestamp()):
                continue
            rows.append((s, d, ev["data"]))
        store.insert_many(bucket_id, rows)
        total += len(rows)
        t += CHUNK
    return bucket_id, total


def main() -> None:
    parser = argparse.ArgumentParser(prog="tracker.import_aw")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--aw-url", default="http://127.0.0.1:5600")
    args = parser.parse_args()

    store = Store(args.db)
    for aw_id, info in _get(args.aw_url, "buckets/").items():
        bucket_id, n = import_bucket(store, args.aw_url, aw_id, info)
        print(f"{aw_id} -> {bucket_id}: {n} events")


if __name__ == "__main__":
    main()
