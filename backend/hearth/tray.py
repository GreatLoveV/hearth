"""System tray icon: recording status, open the dashboard, pause, quit, and goal notifications."""

from __future__ import annotations

import logging
import threading
import webbrowser
from datetime import date
from typing import Callable

import pystray

from .icon import make_image

log = logging.getLogger("hearth.tray")

STATUS_TEXT = {
    "recording": "Recording",
    "paused": "Paused",
    "error": "A watcher stopped. Quit and reopen Hearth.",
    "off": "Not recording (watchers off)",
}


def run_tray(url: str, runtime, notifier, stop: threading.Event, on_quit: Callable[[], None]) -> None:
    images = {s: make_image(64, state=s) for s in ("recording", "paused", "error", "off")}

    def state() -> str:
        return runtime.status()["state"]

    def refresh(icon: pystray.Icon) -> None:
        s = state()
        icon.icon = images[s]
        icon.title = f"Hearth: {STATUS_TEXT[s]}"
        icon.update_menu()

    def toggle_pause(icon, item) -> None:
        if runtime.paused.is_set():
            runtime.paused.clear()
        else:
            runtime.paused.set()
        refresh(icon)

    def quit_app(icon, item) -> None:
        on_quit()
        stop.set()
        icon.stop()

    icon = pystray.Icon(
        "hearth",
        images["recording"],
        "Hearth",
        menu=pystray.Menu(
            pystray.MenuItem(lambda item: STATUS_TEXT[state()], None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open dashboard", lambda icon, item: webbrowser.open(url), default=True),
            pystray.MenuItem("Pause recording", toggle_pause, checked=lambda item: runtime.paused.is_set()),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Quit Hearth", quit_app),
        ),
    )

    def background(icon: pystray.Icon) -> None:
        icon.visible = True
        ticks = 0
        while not stop.is_set():
            try:
                refresh(icon)
                if ticks % 4 == 0:  # goals every minute
                    for title, message in notifier.due(date.today()):
                        icon.notify(message, title)
            except Exception:
                log.exception("tray update failed")
            ticks += 1
            stop.wait(15)

    icon.run(setup=background)
