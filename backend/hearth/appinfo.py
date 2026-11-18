"""Where each app lives on disk, and its icon.

The watchers note the executable path the first time they see an app in each run. The icon is
read out of that executable with the Windows shell API, turned into a PNG with Pillow and kept in
~/.hearth/icons, so each one is only extracted once.
"""

from __future__ import annotations

import hashlib
import io
import logging
import sys
import threading
import time
from pathlib import Path

import psutil

from .categories import app_key
from .db import Store

log = logging.getLogger("hearth.appinfo")

ICON_DIR = Path.home() / ".hearth" / "icons"
UPLOAD_FORMATS = {"PNG", "JPEG", "WEBP", "GIF", "BMP", "ICO"}
MAX_UPLOAD = 4 * 1024 * 1024
ICON_SIZE = 64


class ExeBook:
    """Remembers the executable path for each app name, writing each one once per run."""

    def __init__(self, store: Store):
        self.store = store
        self._known: set[str] = set()
        self._lock = threading.Lock()

    def note(self, app: str, pid: int | None = None, exe: str | None = None) -> None:
        key = app_key(app)
        if not key or key in self._known:
            return
        if exe is None and pid:
            try:
                exe = psutil.Process(pid).exe()
            except (psutil.Error, ValueError, OSError):
                exe = None
        if not exe:
            return
        with self._lock:
            if key in self._known:
                return
            self._known.add(key)
        try:
            self.store.remember_exe(key, exe, time.time())
        except Exception:
            log.exception("could not save the path for %s", app)


# Icon extraction (Windows) -----------------------------------------------------------

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _user32 = ctypes.windll.user32
    _gdi32 = ctypes.windll.gdi32

    class _ICONINFO(ctypes.Structure):
        _fields_ = [("fIcon", wintypes.BOOL), ("xHotspot", wintypes.DWORD), ("yHotspot", wintypes.DWORD),
                    ("hbmMask", wintypes.HBITMAP), ("hbmColor", wintypes.HBITMAP)]

    class _BITMAP(ctypes.Structure):
        _fields_ = [("bmType", wintypes.LONG), ("bmWidth", wintypes.LONG), ("bmHeight", wintypes.LONG),
                    ("bmWidthBytes", wintypes.LONG), ("bmPlanes", wintypes.WORD), ("bmBitsPixel", wintypes.WORD),
                    ("bmBits", ctypes.c_void_p)]

    class _BITMAPINFOHEADER(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

    _user32.PrivateExtractIconsW.argtypes = [wintypes.LPCWSTR, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                             ctypes.POINTER(wintypes.HICON), ctypes.POINTER(wintypes.UINT),
                                             wintypes.UINT, wintypes.UINT]
    _user32.PrivateExtractIconsW.restype = wintypes.UINT
    _user32.GetIconInfo.argtypes = [wintypes.HICON, ctypes.POINTER(_ICONINFO)]
    _user32.DestroyIcon.argtypes = [wintypes.HICON]
    _user32.GetDC.argtypes = [wintypes.HWND]
    _user32.GetDC.restype = wintypes.HDC
    _user32.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    _gdi32.GetObjectW.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p]
    _gdi32.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, ctypes.c_void_p,
                                 ctypes.c_void_p, wintypes.UINT]
    _gdi32.DeleteObject.argtypes = [wintypes.HGDIOBJ]

    def _bitmap_bgra(hdc, hbm, width: int, height: int) -> bytes:
        header = _BITMAPINFOHEADER()
        header.biSize = ctypes.sizeof(header)
        header.biWidth = width
        header.biHeight = -height  # top-down rows
        header.biPlanes = 1
        header.biBitCount = 32
        buf = ctypes.create_string_buffer(width * height * 4)
        if not _gdi32.GetDIBits(hdc, hbm, 0, height, buf, ctypes.byref(header), 0):
            raise OSError("GetDIBits failed")
        return buf.raw

    def _extract(exe: str, size: int):
        from PIL import Image

        hicon = wintypes.HICON()
        got = _user32.PrivateExtractIconsW(exe, 0, size, size, ctypes.byref(hicon), None, 1, 0)
        if got in (0, 0xFFFFFFFF) or not hicon:
            return None
        info = _ICONINFO()
        hdc = _user32.GetDC(None)
        try:
            if not _user32.GetIconInfo(hicon, ctypes.byref(info)):
                return None
            if not info.hbmColor:  # monochrome icon: not worth drawing
                return None
            bm = _BITMAP()
            _gdi32.GetObjectW(info.hbmColor, ctypes.sizeof(bm), ctypes.byref(bm))
            w, h = bm.bmWidth, bm.bmHeight
            color = bytearray(_bitmap_bgra(hdc, info.hbmColor, w, h))
            if not any(color[3::4]):
                # Older icons have no alpha channel; the mask says which pixels are see-through.
                mask = _bitmap_bgra(hdc, info.hbmMask, w, h)
                color[3::4] = bytes(0 if mask[i] else 255 for i in range(0, len(mask), 4))
            img = Image.frombuffer("RGBA", (w, h), bytes(color), "raw", "BGRA", 0, 1)
            if not img.getbbox():
                return None
            return img.resize((size, size), Image.LANCZOS) if (w, h) != (size, size) else img
        finally:
            for hbm in (info.hbmColor, info.hbmMask):
                if hbm:
                    _gdi32.DeleteObject(hbm)
            _user32.ReleaseDC(None, hdc)
            _user32.DestroyIcon(hicon)
else:
    def _extract(exe: str, size: int):  # noqa: ARG001 - icons are only read on Windows
        return None


class Icons:
    """App icons as PNG bytes, extracted once and cached on disk. Misses are remembered for this run."""

    def __init__(self, store: Store, directory: Path = ICON_DIR):
        self.store = store
        self.directory = directory
        self._missing: dict[str, float] = {}
        self._lock = threading.Lock()

    def _path(self, key: str) -> Path:
        return self.directory / (hashlib.sha1(key.encode("utf-8")).hexdigest()[:20] + ".png")

    def _custom_path(self, key: str) -> Path:
        return self.directory / ("custom-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:20] + ".png")

    def set_custom(self, app: str, data: bytes) -> None:
        """Store an uploaded image as the app's icon: any common format, fitted into a 64px square."""
        from PIL import Image, UnidentifiedImageError

        key = app_key(app)
        try:
            with Image.open(io.BytesIO(data)) as src:
                if src.format not in UPLOAD_FORMATS:
                    raise ValueError("Use a PNG, JPEG, WebP, GIF, BMP or ICO image.")
                if src.width * src.height > 40_000_000:
                    raise ValueError("That image is too large.")
                if src.format == "ICO":
                    src.size = max(src.info.get("sizes") or [src.size])  # the sharpest size in the file
                img = src.convert("RGBA")
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
            raise ValueError("That file isn't an image Hearth can read.") from None
        img.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        tile = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
        tile.paste(img, ((ICON_SIZE - img.width) // 2, (ICON_SIZE - img.height) // 2))
        out = io.BytesIO()
        tile.save(out, "PNG", optimize=True)
        self.directory.mkdir(parents=True, exist_ok=True)
        self._custom_path(key).write_bytes(out.getvalue())

    def clear_custom(self, app: str) -> None:
        self._custom_path(app_key(app)).unlink(missing_ok=True)

    def png(self, app: str) -> bytes | None:
        key = app_key(app)
        if not key:
            return None
        custom = self._custom_path(key)
        if custom.exists():
            return custom.read_bytes()
        path = self._path(key)
        if path.exists():
            return path.read_bytes()
        if time.time() - self._missing.get(key, 0) < 600:  # try again later: the app may run by then
            return None
        exe = self.store.exe_for(key)
        img = None
        if exe and Path(exe).exists():
            with self._lock:  # the shell API is happier one call at a time
                try:
                    img = _extract(exe, ICON_SIZE)
                except Exception:
                    log.exception("could not read the icon of %s", exe)
        if img is None:
            self._missing[key] = time.time()
            return None
        out = io.BytesIO()
        img.save(out, "PNG", optimize=True)
        data = out.getvalue()
        try:
            self.directory.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        except OSError:
            log.exception("could not cache the icon of %s", app)
        return data
