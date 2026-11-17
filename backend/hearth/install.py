"""Create Windows shortcuts for Hearth.

    python -m hearth.install                    desktop and Start menu shortcuts
    python -m hearth.install --autostart        also start Hearth when you log in
    python -m hearth.install --no-autostart     stop starting Hearth at login

Shortcuts run `pythonw -m hearth --tray`, so there is no console window.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

from .icon import write_ico

BACKEND = Path(__file__).resolve().parents[1]
ICON = Path.home() / ".hearth" / "hearth.ico"
START_MENU = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs"
STARTUP = START_MENU / "Startup"


def _ps_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def desktop_dir() -> Path:
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", "[Environment]::GetFolderPath('Desktop')"],
        capture_output=True, text=True, check=True,
    )
    return Path(out.stdout.strip())


def make_shortcut(path: Path, arguments: str) -> None:
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    script = (
        f"$s = (New-Object -ComObject WScript.Shell).CreateShortcut({_ps_quote(str(path))});"
        f"$s.TargetPath = {_ps_quote(str(pythonw))};"
        f"$s.Arguments = {_ps_quote(arguments)};"
        f"$s.WorkingDirectory = {_ps_quote(str(BACKEND))};"
        f"$s.IconLocation = {_ps_quote(str(ICON))};"
        f"$s.Description = 'Open the Hearth dashboard';"
        f"$s.Save()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", script], check=True)
    print(f"Created {path}")


def main() -> None:
    parser = argparse.ArgumentParser(prog="hearth.install")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--autostart", action="store_true")
    group.add_argument("--no-autostart", action="store_true")
    args = parser.parse_args()

    write_ico(ICON)
    make_shortcut(desktop_dir() / "Hearth.lnk", "-m hearth --tray --open")
    make_shortcut(START_MENU / "Hearth.lnk", "-m hearth --tray --open")

    startup_link = STARTUP / "Hearth.lnk"
    if args.autostart:
        make_shortcut(startup_link, "-m hearth --tray")
    elif args.no_autostart and startup_link.exists():
        startup_link.unlink()
        print(f"Removed {startup_link}")


if __name__ == "__main__":
    main()
