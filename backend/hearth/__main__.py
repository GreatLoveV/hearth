"""Run Hearth.

    python -m hearth                 server and watchers, logs to the console
    pythonw -m hearth --tray --open  same, with a tray icon and no console window, then opens the dashboard

If Hearth is already running on the port, this just opens the dashboard.
"""

from __future__ import annotations

import argparse
import json
import logging
import logging.handlers
import socket
import sys
import threading
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from .api import Runtime, create_app
from .appinfo import ExeBook
from .categories import Categorizer, PrivacyFilter
from .db import DEFAULT_DB, Store
from .maintenance import backup_loop
from .resources import ResourceMonitor
from .settings import Settings
from .summary import Reader

LOG_FILE = Path.home() / ".hearth" / "hearth.log"


def already_running(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as res:
            return bool(json.load(res).get("ok"))
    except Exception:
        return False


def setup_logging(to_file: bool) -> None:
    if to_file:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        handler: logging.Handler = logging.handlers.RotatingFileHandler(
            LOG_FILE, maxBytes=1_000_000, backupCount=2, encoding="utf-8"
        )
    else:
        handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler])


class LiveRules:
    """Privacy and category rules for the watchers, rebuilt whenever settings change."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.reload()
        settings.listeners.append(lambda key: self.reload())

    def reload(self) -> None:
        self.privacy = PrivacyFilter(self.settings.privacy)
        self.categorize = Categorizer(self.settings.categories)

    def is_media_app(self, app: str) -> bool:
        return self.categorize.app_category(app) == "Media"


def start_watchers(store: Store, settings: Settings, runtime: Runtime, stop: threading.Event) -> None:
    if sys.platform != "win32":
        logging.warning("Watchers only support Windows for now; running without them.")
        runtime.watchers = False
        return
    from . import watchers

    rules = LiveRules(settings)
    exes = ExeBook(store)
    monitor = ResourceMonitor(
        store, stop, runtime.paused,
        is_private=lambda app: rules.privacy.hides_app(app),
        note_exe=exes.note,
    )
    runtime.monitor = monitor
    monitor.start()

    def emit(bucket_id: str, ts: float, data: dict, pulsetime: float):
        if not runtime.paused.is_set():
            store.heartbeat(bucket_id, ts, data, pulsetime)

    ctx = watchers.WatchContext(
        emit=emit,
        accuracy=lambda: settings.accuracy,
        privacy=lambda d: rules.privacy.apply(d),
        is_media_app=rules.is_media_app,
        stop=stop,
        health=runtime.health,
        note_exe=exes.note,
    )
    host = socket.gethostname()
    win_id, afk_id = f"window_{host}", f"afk_{host}"
    store.ensure_bucket(win_id, "currentwindow", host)
    store.ensure_bucket(afk_id, "afkstatus", host)
    for target, bucket in ((watchers.window_loop, win_id), (watchers.afk_loop, afk_id)):
        threading.Thread(target=target, args=(ctx, bucket), daemon=True, name=target.__name__).start()


def main() -> None:
    parser = argparse.ArgumentParser(prog="hearth")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="SQLite database path")
    parser.add_argument("--port", type=int, default=5600)
    parser.add_argument("--no-watchers", action="store_true", help="serve data only, don't record")
    parser.add_argument("--no-backups", action="store_true", help="skip the daily database backup")
    parser.add_argument("--tray", action="store_true", help="show a tray icon and log to a file")
    parser.add_argument("--open", action="store_true", help="open the dashboard in the browser")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    if already_running(args.port):
        webbrowser.open(url)
        return

    setup_logging(to_file=args.tray or sys.stdout is None)
    store = Store(args.db)
    settings = Settings(store)
    runtime = Runtime(watchers=not args.no_watchers)
    stop = threading.Event()
    if runtime.watchers:
        start_watchers(store, settings, runtime, stop)
    if not args.no_backups:
        threading.Thread(target=backup_loop, args=(store, stop), daemon=True, name="backups").start()

    logging.info("Database: %s", store.path)
    logging.info("Dashboard: %s", url)
    config = uvicorn.Config(
        create_app(store, settings, runtime), host="127.0.0.1", port=args.port,
        log_level="warning", log_config=None,
    )
    server = uvicorn.Server(config)

    if args.open:
        def open_when_ready():
            for _ in range(50):
                if server.started:
                    webbrowser.open(url)
                    return
                stop.wait(0.2)

        threading.Thread(target=open_when_ready, daemon=True).start()

    try:
        if args.tray:
            from .goals import Notifier
            from .tray import run_tray

            threading.Thread(target=server.run, daemon=True, name="server").start()
            notifier = Notifier(Reader(store, settings), settings)
            run_tray(url, runtime, notifier, stop, on_quit=lambda: setattr(server, "should_exit", True))
        else:
            server.run()
    finally:
        stop.set()


if __name__ == "__main__":
    main()
