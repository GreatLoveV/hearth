"""Windows watchers: the active window, and whether you're at the computer.

Each watcher calls `ctx.emit(bucket_id, timestamp, data, pulsetime)` on every poll and records
its last successful poll in `ctx.health`, which the tray and the status API read.

You count as active when any of these is true:
- keyboard or mouse input within the AFK timeout
- controller input within the timeout (XInput: Xbox pads, and others through Steam Input)
- the foreground app is full screen (games, video), if enabled in settings
- the foreground app is a Media app that is playing sound, if enabled in settings
The lock screen always counts as away.
"""

from __future__ import annotations

import ctypes
import logging
import threading
import time
from ctypes import wintypes
from dataclasses import dataclass, field
from typing import Callable

import psutil

from .categories import app_key

log = logging.getLogger("hearth.watchers")

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
user32.MonitorFromWindow.restype = wintypes.HMONITOR
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
kernel32.GetTickCount.restype = wintypes.DWORD

LOCK_APPS = {"lockapp", "logonui"}
SHELL_CLASSES = {"Progman", "WorkerW", "Shell_TrayWnd"}


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.UINT), ("dwTime", wintypes.DWORD)]


class MONITORINFO(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT),
                ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]


@dataclass
class WatchContext:
    emit: Callable[[str, float, dict, float], object]
    accuracy: Callable[[], object]          # -> settings.Accuracy
    privacy: Callable[[dict], dict]          # applies privacy rules to window data
    is_media_app: Callable[[str], bool]
    stop: threading.Event
    health: dict[str, float] = field(default_factory=dict)


# Window ----------------------------------------------------------------------------


def _foreground() -> tuple[int, int, str] | None:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    try:
        app = psutil.Process(pid.value).name()
    except (psutil.Error, ValueError):
        app = "unknown"
    return hwnd, pid.value, app


def _title(hwnd: int) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


def is_fullscreen(hwnd: int) -> bool:
    cls = ctypes.create_unicode_buffer(64)
    user32.GetClassNameW(hwnd, cls, 64)
    if cls.value in SHELL_CLASSES:
        return False
    rect = wintypes.RECT()
    if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
        return False
    mon = user32.MonitorFromWindow(hwnd, 2)  # MONITOR_DEFAULTTONEAREST
    info = MONITORINFO()
    info.cbSize = ctypes.sizeof(info)
    if not user32.GetMonitorInfoW(mon, ctypes.byref(info)):
        return False
    m = info.rcMonitor
    return rect.left <= m.left and rect.top <= m.top and rect.right >= m.right and rect.bottom >= m.bottom


def window_loop(ctx: WatchContext, bucket_id: str, poll: float = 1.0) -> None:
    while not ctx.stop.is_set():
        try:
            fg = _foreground()
            if fg and app_key(fg[2]) not in LOCK_APPS:
                data = ctx.privacy({"app": fg[2], "title": _title(fg[0])})
                ctx.emit(bucket_id, time.time(), data, poll + 1.0)
            ctx.health["window"] = time.time()
        except Exception:  # keep the watcher alive through transient OS errors
            log.exception("window watcher poll failed")
        ctx.stop.wait(poll)


# Input and activity -------------------------------------------------------------------


def input_idle_seconds() -> float:
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not user32.GetLastInputInfo(ctypes.byref(info)):
        return 0.0
    return ((kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000.0


class XINPUT_GAMEPAD(ctypes.Structure):
    _fields_ = [("wButtons", wintypes.WORD), ("bLeftTrigger", ctypes.c_ubyte), ("bRightTrigger", ctypes.c_ubyte),
                ("sThumbLX", ctypes.c_short), ("sThumbLY", ctypes.c_short),
                ("sThumbRX", ctypes.c_short), ("sThumbRY", ctypes.c_short)]


class XINPUT_STATE(ctypes.Structure):
    _fields_ = [("dwPacketNumber", wintypes.DWORD), ("Gamepad", XINPUT_GAMEPAD)]


class ControllerMonitor(threading.Thread):
    """Polls XInput pads and remembers the last real input, ignoring stick drift."""

    THUMB_DEADZONE = 8000
    TRIGGER_DEADZONE = 30

    def __init__(self, stop: threading.Event):
        super().__init__(daemon=True, name="controller")
        self.stop = stop
        self.last_input = 0.0
        self._prev: dict[int, tuple] = {}
        self._xinput = None
        for dll in ("xinput1_4", "xinput1_3", "xinput9_1_0"):
            try:
                self._xinput = getattr(ctypes.windll, dll)
                break
            except OSError:
                continue

    def _changed(self, pad: int, g: XINPUT_GAMEPAD) -> bool:
        def zone(v: int) -> int:
            return 0 if abs(v) < self.THUMB_DEADZONE else v // 4000

        state = (g.wButtons, g.bLeftTrigger // self.TRIGGER_DEADZONE, g.bRightTrigger // self.TRIGGER_DEADZONE,
                 zone(g.sThumbLX), zone(g.sThumbLY), zone(g.sThumbRX), zone(g.sThumbRY))
        prev = self._prev.get(pad)
        self._prev[pad] = state
        rest = (0, 0, 0, 0, 0, 0, 0)
        return prev is not None and (state != prev or state != rest)

    def run(self) -> None:
        if not self._xinput:
            log.info("XInput not available; controller input won't count as activity")
            return
        state = XINPUT_STATE()
        while not self.stop.is_set():
            connected = False
            for pad in range(4):
                if self._xinput.XInputGetState(pad, ctypes.byref(state)) == 0:
                    connected = True
                    if self._changed(pad, state.Gamepad):
                        self.last_input = time.time()
                else:
                    self._prev.pop(pad, None)
            # Poll fast while a pad is connected, slowly otherwise.
            self.stop.wait(0.1 if connected else 2.0)

    def idle_seconds(self) -> float:
        return time.time() - self.last_input if self.last_input else float("inf")


class AudioMonitor:
    """Remembers when each app last produced sound (Windows audio sessions)."""

    def __init__(self):
        self.last_sound: dict[str, float] = {}
        self._ok = None

    def sample(self) -> None:
        if self._ok is False:
            return
        try:
            import comtypes
            from pycaw.pycaw import AudioUtilities, IAudioMeterInformation

            if self._ok is None:
                comtypes.CoInitialize()
            now = time.time()
            for s in AudioUtilities.GetAllSessions():
                if s.Process is None:
                    continue
                meter = s._ctl.QueryInterface(IAudioMeterInformation)
                if meter.GetPeakValue() > 0.001:
                    self.last_sound[app_key(s.Process.name())] = now
            self._ok = True
        except Exception:
            if self._ok is None:
                log.exception("audio detection unavailable; media playback won't count as activity")
                self._ok = False

    def playing(self, app: str, within: float = 60.0) -> bool:
        return time.time() - self.last_sound.get(app_key(app), 0) < within


def afk_loop(ctx: WatchContext, bucket_id: str, poll: float = 5.0) -> None:
    controller = ControllerMonitor(ctx.stop)
    controller.start()
    audio = AudioMonitor()
    afk = False
    pulse = poll + 1.0
    while not ctx.stop.is_set():
        try:
            acc = ctx.accuracy()
            timeout = acc.afk_minutes * 60
            now = time.time()
            idle = input_idle_seconds()
            if acc.controller_active:
                idle = min(idle, controller.idle_seconds())
            if acc.media_audio_active:
                audio.sample()

            fg = _foreground()
            locked = fg is not None and app_key(fg[2]) in LOCK_APPS
            watching = False
            if fg and not locked and idle >= timeout:
                if acc.fullscreen_active and is_fullscreen(fg[0]):
                    watching = True
                elif acc.media_audio_active and ctx.is_media_app(fg[2]) and audio.playing(fg[2]):
                    watching = True

            away = locked or (idle >= timeout and not watching)
            last_input = now if watching else now - idle
            if not afk and away:
                mark = now if locked else last_input
                ctx.emit(bucket_id, mark, {"status": "not-afk"}, pulse)
                ctx.emit(bucket_id, mark, {"status": "afk"}, pulse)
                afk = True
            elif afk and not away:
                ctx.emit(bucket_id, last_input, {"status": "afk"}, pulse)
                ctx.emit(bucket_id, last_input, {"status": "not-afk"}, pulse)
                afk = False
            else:
                ctx.emit(bucket_id, now, {"status": "afk" if afk else "not-afk"}, pulse)
            ctx.health["afk"] = time.time()
        except Exception:
            log.exception("afk watcher poll failed")
        ctx.stop.wait(poll)
