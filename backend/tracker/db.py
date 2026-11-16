"""SQLite storage: buckets, events, settings and a per-day summary cache.

Timestamps are unix epoch seconds (floats). An event covers [start, start + duration].
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_DB = Path(os.environ.get("TRACKER_DB", Path.home() / ".tracker" / "tracker.db"))

# Range queries only look this far back for events that started earlier but still overlap,
# which keeps them on the (bucket_id, start) index instead of scanning all history.
MAX_EVENT_SPAN = 7 * 86400

SCHEMA = """
CREATE TABLE IF NOT EXISTS buckets (
    id       TEXT PRIMARY KEY,
    type     TEXT NOT NULL,
    hostname TEXT NOT NULL,
    created  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    bucket_id TEXT NOT NULL REFERENCES buckets(id) ON DELETE CASCADE,
    start     REAL NOT NULL,
    duration  REAL NOT NULL DEFAULT 0,
    data      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_bucket_start ON events(bucket_id, start);
CREATE INDEX IF NOT EXISTS idx_events_start ON events(start, id);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_cache (
    day  TEXT PRIMARY KEY,
    rev  INTEGER NOT NULL,
    data TEXT NOT NULL
);
"""


@dataclass
class Event:
    id: int
    bucket_id: str
    start: float
    duration: float
    data: dict

    @property
    def end(self) -> float:
        return self.start + self.duration

    def to_dict(self) -> dict:
        return {"id": self.id, "start": self.start, "duration": self.duration, "data": self.data}


class Store:
    def __init__(self, path: Path = DEFAULT_DB):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(SCHEMA)
        self._lock = threading.RLock()

    # Buckets -----------------------------------------------------------------

    def ensure_bucket(self, bucket_id: str, type_: str, hostname: str) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT OR IGNORE INTO buckets (id, type, hostname, created) VALUES (?, ?, ?, ?)",
                (bucket_id, type_, hostname, datetime.now(timezone.utc).isoformat()),
            )

    def buckets(self) -> list[dict]:
        with self._lock:
            rows = self._conn.execute("SELECT id, type, hostname, created FROM buckets").fetchall()
        return [{"id": r[0], "type": r[1], "hostname": r[2], "created": r[3]} for r in rows]

    def bucket_exists(self, bucket_id: str) -> bool:
        with self._lock:
            row = self._conn.execute("SELECT 1 FROM buckets WHERE id = ?", (bucket_id,)).fetchone()
        return row is not None

    def bucket_ids(self, type_: str) -> list[str]:
        return [b["id"] for b in self.buckets() if b["type"] == type_]

    # Events ------------------------------------------------------------------

    def insert_event(self, bucket_id: str, start: float, duration: float, data: dict) -> Event:
        payload = json.dumps(data, sort_keys=True)
        with self._lock, self._conn:
            cur = self._conn.execute(
                "INSERT INTO events (bucket_id, start, duration, data) VALUES (?, ?, ?, ?)",
                (bucket_id, start, duration, payload),
            )
        return Event(cur.lastrowid, bucket_id, start, duration, data)

    def insert_many(self, bucket_id: str, rows: list[tuple[float, float, dict]]) -> None:
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO events (bucket_id, start, duration, data) VALUES (?, ?, ?, ?)",
                [(bucket_id, s, d, json.dumps(data, sort_keys=True)) for s, d, data in rows],
            )

    def clear_bucket(self, bucket_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM events WHERE bucket_id = ?", (bucket_id,))

    def earliest_start(self, bucket_type: str, exclude_prefix: str) -> float | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT MIN(e.start) FROM events e JOIN buckets b ON b.id = e.bucket_id "
                "WHERE b.type = ? AND b.id NOT LIKE ?",
                (bucket_type, exclude_prefix + "%"),
            ).fetchone()
        return row[0]

    def heartbeat(self, bucket_id: str, ts: float, data: dict, pulsetime: float) -> Event:
        """Extend the latest event if it has the same data and is recent enough, else start a new one."""
        payload = json.dumps(data, sort_keys=True)
        with self._lock, self._conn:
            row = self._conn.execute(
                "SELECT id, start, duration, data FROM events WHERE bucket_id = ? "
                "ORDER BY start DESC, id DESC LIMIT 1",
                (bucket_id,),
            ).fetchone()
            if row and row[3] == payload and row[1] <= ts <= row[1] + row[2] + pulsetime:
                duration = max(row[2], ts - row[1])
                self._conn.execute("UPDATE events SET duration = ? WHERE id = ?", (duration, row[0]))
                return Event(row[0], bucket_id, row[1], duration, data)
            cur = self._conn.execute(
                "INSERT INTO events (bucket_id, start, duration, data) VALUES (?, ?, 0, ?)",
                (bucket_id, ts, payload),
            )
            return Event(cur.lastrowid, bucket_id, ts, 0.0, data)

    def events(self, bucket_id: str, start: float, end: float) -> list[Event]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT id, start, duration, data FROM events "
                "WHERE bucket_id = ? AND start < ? AND start > ? AND start + duration > ? ORDER BY start",
                (bucket_id, end, start - MAX_EVENT_SPAN, start),
            ).fetchall()
        return [Event(r[0], bucket_id, r[1], r[2], json.loads(r[3])) for r in rows]

    def events_of_type(self, type_: str, start: float, end: float) -> list[Event]:
        out: list[Event] = []
        for bucket_id in self.bucket_ids(type_):
            out += self.events(bucket_id, start, end)
        out.sort(key=lambda e: e.start)
        return out

    def search_events(self, type_: str, needle: str, limit: int) -> list[Event]:
        """Events whose JSON data contains `needle` (case-insensitive), newest first."""
        ids = self.bucket_ids(type_)
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        escaped = needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        with self._lock:
            rows = self._conn.execute(
                f"SELECT id, bucket_id, start, duration, data FROM events WHERE bucket_id IN ({marks}) "
                "AND data LIKE ? ESCAPE '\\' ORDER BY start DESC LIMIT ?",
                (*ids, f"%{escaped}%", limit),
            ).fetchall()
        return [Event(r[0], r[1], r[2], r[3], json.loads(r[4])) for r in rows]

    def app_totals(self) -> list[tuple[str, float]]:
        ids = self.bucket_ids("currentwindow")
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        with self._lock:
            return self._conn.execute(
                f"SELECT json_extract(data, '$.app') AS app, SUM(duration) FROM events "
                f"WHERE bucket_id IN ({marks}) GROUP BY app ORDER BY SUM(duration) DESC",
                ids,
            ).fetchall()

    def all_events(self, start: float, end: float):
        """Every event in [start, end) with its bucket type, oldest first (for export)."""
        last_start, last_id = start, -1
        while True:  # page through by (start, id) so big exports don't sit in memory
            with self._lock:
                rows = self._conn.execute(
                    "SELECT e.id, b.id, b.type, e.start, e.duration, e.data FROM events e "
                    "JOIN buckets b ON b.id = e.bucket_id "
                    "WHERE (e.start > ? OR (e.start = ? AND e.id > ?)) AND e.start < ? "
                    "ORDER BY e.start, e.id LIMIT 5000",
                    (last_start, last_start, last_id, end),
                ).fetchall()
            if not rows:
                return
            for eid, bucket_id, type_, s, d, data in rows:
                if s >= start:
                    yield bucket_id, type_, s, d, json.loads(data)
            last_id, last_start = rows[-1][0], rows[-1][3]

    def forget(self, start: float, end: float) -> int:
        """Remove everything recorded between start and end, trimming events that cross the edges."""
        changed = 0
        with self._lock, self._conn:
            rows = self._conn.execute(
                "SELECT id, bucket_id, start, duration, data FROM events "
                "WHERE start < ? AND start > ? AND start + duration > ?",
                (end, start - MAX_EVENT_SPAN, start),
            ).fetchall()
            for eid, bucket_id, s, d, data in rows:
                e = s + d
                if s >= start and e <= end:
                    self._conn.execute("DELETE FROM events WHERE id = ?", (eid,))
                elif s < start and e > end:
                    self._conn.execute("UPDATE events SET duration = ? WHERE id = ?", (start - s, eid))
                    self._conn.execute(
                        "INSERT INTO events (bucket_id, start, duration, data) VALUES (?, ?, ?, ?)",
                        (bucket_id, end, e - end, data),
                    )
                elif s < start:
                    self._conn.execute("UPDATE events SET duration = ? WHERE id = ?", (start - s, eid))
                else:
                    self._conn.execute(
                        "UPDATE events SET start = ?, duration = ? WHERE id = ?", (end, e - end, eid)
                    )
                changed += 1
        self.bump_revision()
        return changed

    # Settings ----------------------------------------------------------------

    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, json.dumps(value)),
            )

    def revision(self) -> int:
        return int(self.get_setting("_rev", 0))

    def bump_revision(self) -> None:
        with self._lock:
            self.set_setting("_rev", self.revision() + 1)

    # Day cache ---------------------------------------------------------------

    def cached_days(self, days: list[str], rev: int) -> dict[str, dict]:
        if not days:
            return {}
        marks = ",".join("?" * len(days))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT day, data FROM day_cache WHERE rev = ? AND day IN ({marks})", (rev, *days)
            ).fetchall()
        return {d: json.loads(data) for d, data in rows}

    def cache_days(self, items: dict[str, dict], rev: int) -> None:
        with self._lock, self._conn:
            self._conn.executemany(
                "INSERT INTO day_cache (day, rev, data) VALUES (?, ?, ?) "
                "ON CONFLICT(day) DO UPDATE SET rev = excluded.rev, data = excluded.data",
                [(d, rev, json.dumps(v)) for d, v in items.items()],
            )

    # Maintenance ---------------------------------------------------------------

    def backup_to(self, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        dest = sqlite3.connect(target)
        try:
            with self._lock:
                self._conn.backup(dest)
        finally:
            dest.close()

    def size_bytes(self) -> int:
        return sum(p.stat().st_size for p in self.path.parent.glob(self.path.name + "*") if p.is_file())
