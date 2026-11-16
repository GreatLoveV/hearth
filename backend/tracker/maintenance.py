"""Backups and exports."""

from __future__ import annotations

import csv
import gzip
import io
import json
import logging
import shutil
import threading
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Iterator

from .db import Store

log = logging.getLogger("tracker.maintenance")

BACKUP_DIR = Path.home() / ".tracker" / "backups"
KEEP_BACKUPS = 7


def backups(directory: Path = BACKUP_DIR) -> list[Path]:
    return sorted(directory.glob("tracker-*.db.gz"))


def backup_now(store: Store, directory: Path = BACKUP_DIR, keep: int = KEEP_BACKUPS) -> Path:
    """Write today's compressed backup if it doesn't exist yet, and keep only the newest `keep`."""
    target = directory / f"tracker-{date.today().isoformat()}.db.gz"
    if not target.exists():
        raw = directory / f".tracker-{date.today().isoformat()}.db.tmp"
        store.backup_to(raw)
        with open(raw, "rb") as src, gzip.open(target, "wb", compresslevel=6) as dst:
            shutil.copyfileobj(src, dst, 1 << 20)
        raw.unlink(missing_ok=True)
        log.info("Backup written: %s", target)
    for old in backups(directory)[:-keep]:
        old.unlink(missing_ok=True)
    return target


def backup_loop(store: Store, stop: threading.Event, every_hours: float = 6) -> None:
    while not stop.is_set():
        try:
            backup_now(store)
        except Exception:
            log.exception("backup failed")
        stop.wait(every_hours * 3600)


EXPORT_FIELDS = ["bucket", "type", "start", "end", "duration_seconds", "app", "title", "url", "status"]


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def export_csv(store: Store, start: float, end: float) -> Iterator[str]:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(EXPORT_FIELDS)
    yield "﻿" + buf.getvalue()  # BOM so Excel reads UTF-8
    for bucket, type_, s, d, data in store.all_events(start, end):
        buf.seek(0)
        buf.truncate()
        w.writerow([bucket, type_, _iso(s), _iso(s + d), round(d, 3), data.get("app", ""),
                    data.get("title", ""), data.get("url", ""), data.get("status", "")])
        yield buf.getvalue()


def export_json(store: Store, start: float, end: float) -> Iterator[str]:
    yield "["
    first = True
    for bucket, type_, s, d, data in store.all_events(start, end):
        row = {"bucket": bucket, "type": type_, "start": _iso(s), "duration": d, "data": data}
        yield ("" if first else ",\n") + json.dumps(row, ensure_ascii=False)
        first = False
    yield "]\n"
