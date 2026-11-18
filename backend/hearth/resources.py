"""How much processor, memory and disk each app uses.

Every 10 seconds the monitor walks the running processes, adds them up per app (Firefox and
Chrome run as dozens of processes) and folds the result into one row per app per hour in the
`usage` table: number of samples, summed and peak processor share, summed and peak memory, and
bytes read and written. Averages are "while it was running", since an app only gets a sample
when it's open. The latest sample is also kept in memory for the live view.

Processor share is a percentage of the whole machine, so 100% means every core is busy.
Memory is the working set: the RAM the app is using right now, as Task Manager's details tab
shows it.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime
from typing import Callable

import psutil

from .categories import app_key
from .db import SYSTEM_APP, Store

log = logging.getLogger("hearth.resources")

EVERY = 10.0
MIN_MEMORY = 30 * 1024 * 1024  # apps lighter than this, and idle, aren't worth a row
MIN_CPU = 0.5
SKIP = {"system idle process", "idle", "system", "registry", "memory compression", "memcompression", "secure system"}


def hour_start(t: float) -> float:
    return datetime.fromtimestamp(t).replace(minute=0, second=0, microsecond=0).timestamp()


class ResourceMonitor(threading.Thread):
    def __init__(
        self,
        store: Store,
        stop: threading.Event,
        paused: threading.Event,
        is_private: Callable[[str], bool],
        note_exe: Callable[..., None],
        every: float = EVERY,
    ):
        super().__init__(daemon=True, name="resources")
        self.store = store
        self.stop = stop
        self.paused = paused
        self.is_private = is_private
        self.note_exe = note_exe
        self.every = every
        self.latest: dict | None = None
        self._io: dict[int, float] = {}
        self._primed = False

    def run(self) -> None:
        psutil.cpu_percent(None)
        while not self.stop.is_set():
            try:
                self.sample()
            except Exception:
                log.exception("resource sample failed")
            self.stop.wait(self.every)

    def sample(self) -> None:
        now = time.time()
        ncpu = psutil.cpu_count() or 1
        apps: dict[str, dict] = {}
        io_seen: dict[int, float] = {}
        for p in psutil.process_iter(["name", "exe", "memory_info", "io_counters"], ad_value=None):
            name = p.info["name"] or ""
            key = app_key(name)
            if not key or p.pid == 0 or key in SKIP:
                continue
            try:
                cpu = p.cpu_percent(None) / ncpu
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                cpu = 0.0
            mem = p.info["memory_info"].rss if p.info["memory_info"] else 0
            io_total = 0.0
            if p.info["io_counters"]:
                c = p.info["io_counters"]
                io_total = float(c.read_bytes + c.write_bytes)
                io_seen[p.pid] = io_total
            prev_io = self._io.get(p.pid)
            disk = max(0.0, io_total - prev_io) if prev_io is not None else 0.0
            if p.info["exe"]:
                self.note_exe(name, exe=p.info["exe"])
            a = apps.setdefault(key, {"app": name, "cpu": 0.0, "mem": 0.0, "disk": 0.0, "procs": 0})
            a["cpu"] += cpu
            a["mem"] += mem
            a["disk"] += disk
            a["procs"] += 1
        self._io = io_seen

        vm = psutil.virtual_memory()
        system_cpu = psutil.cpu_percent(None)
        visible = [a for a in apps.values() if not self.is_private(a["app"])]
        visible.sort(key=lambda a: -a["mem"])
        self.latest = {
            "time": now,
            "every": self.every,
            "cpu": system_cpu,
            "cores": ncpu,
            "mem_used": float(vm.total - vm.available),
            "mem_total": float(vm.total),
            "apps": visible,
        }

        # The first pass only primes the processor counters, which start at zero.
        if not self._primed:
            self._primed = True
            return
        if self.paused.is_set():
            return
        rows = [
            (app_key(a["app"]), a["cpu"], a["mem"], a["disk"])
            for a in visible
            if a["mem"] >= MIN_MEMORY or a["cpu"] >= MIN_CPU
        ]
        rows.append((SYSTEM_APP, system_cpu, float(vm.total - vm.available), 0.0))
        self.store.add_usage(hour_start(now), rows)


def summarize(rows: list[tuple], every: float = EVERY) -> dict[str, dict]:
    """Totals per app from hourly usage rows."""
    out: dict[str, dict] = {}
    for hour, app, n, cpu_sum, cpu_max, mem_sum, mem_max, io in rows:
        a = out.setdefault(app, {"samples": 0, "cpu_sum": 0.0, "cpu_max": 0.0, "mem_sum": 0.0, "mem_max": 0.0, "disk": 0.0})
        a["samples"] += n
        a["cpu_sum"] += cpu_sum
        a["cpu_max"] = max(a["cpu_max"], cpu_max)
        a["mem_sum"] += mem_sum
        a["mem_max"] = max(a["mem_max"], mem_max)
        a["disk"] += io
    return {
        app: {
            "cpu_avg": a["cpu_sum"] / a["samples"],
            "cpu_max": a["cpu_max"],
            "mem_avg": a["mem_sum"] / a["samples"],
            "mem_max": a["mem_max"],
            "disk": a["disk"],
            "running": a["samples"] * every,
        }
        for app, a in out.items()
        if a["samples"]
    }
