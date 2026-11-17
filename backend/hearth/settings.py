"""User settings with defaults and validation.

Categories, privacy rules and accuracy options change how history is read, so saving them
bumps the store revision, which invalidates the cached day summaries.
"""

from __future__ import annotations

import threading
import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .db import Store

Short = Field(min_length=1, max_length=120)


class Category(BaseModel):
    name: str = Short
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    apps: list[str] = Field(default_factory=list, max_length=500)
    keywords: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("apps", "keywords")
    @classmethod
    def clean(cls, v: list[str]) -> list[str]:
        out = []
        for s in v:
            s = s.strip()[:200]
            if s and s.lower() not in (x.lower() for x in out):
                out.append(s)
        return out


class Categories(BaseModel):
    categories: list[Category] = Field(max_length=40)
    other_color: str = Field(default="#8a7d76", pattern=r"^#[0-9a-fA-F]{6}$")


class Privacy(BaseModel):
    apps: list[str] = Field(default_factory=list, max_length=500)
    keywords: list[str] = Field(default_factory=list, max_length=500)

    @field_validator("apps", "keywords")
    @classmethod
    def clean(cls, v: list[str]) -> list[str]:
        return Category.clean(v)


class Accuracy(BaseModel):
    afk_minutes: int = Field(default=3, ge=1, le=60)
    fullscreen_active: bool = True
    media_audio_active: bool = True
    controller_active: bool = True


class Goal(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:10], pattern=r"^[a-z0-9]{1,32}$")
    kind: Literal["limit", "target"]
    scope: Literal["category", "app"]
    name: str = Short
    minutes: int = Field(ge=1, le=24 * 60)
    days: list[int] = Field(default_factory=lambda: list(range(7)), max_length=7)

    @field_validator("days")
    @classmethod
    def valid_days(cls, v: list[int]) -> list[int]:
        return sorted({d for d in v if 0 <= d <= 6})


class Goals(BaseModel):
    goals: list[Goal] = Field(default_factory=list, max_length=50)


DEFAULT_CATEGORIES = Categories(
    categories=[
        Category(
            name="Code", color="#8fa0c8",
            apps=["code", "cursor", "devenv", "pycharm*", "idea*", "webstorm*", "rider*", "windowsterminal", "wt",
                  "powershell", "pwsh", "cmd", "sublime_text", "notepad++", "zed", "claude", "opencode"],
            keywords=["github", "gitlab", "stack overflow", "stackoverflow", "localhost", "docs.python", "mdn web docs"],
        ),
        Category(
            name="Communication", color="#d8b25a",
            apps=["slack", "discord", "discordcanary", "discordptb", "teams", "ms-teams", "outlook", "olk", "telegram",
                  "ayugram", "whatsapp", "whatsapp.root", "zoom", "signal"],
            keywords=["gmail", "outlook.live", "web.whatsapp", "discord.com", "slack.com", "telegram"],
        ),
        Category(
            name="Media", color="#d98a8a",
            apps=["spotify", "vlc", "mpv", "mpc-hc", "mpc-hc64", "netflix", "music.ui", "video.ui", "potplayer*", "qbittorrent"],
            keywords=["youtube", "netflix", "twitch", "prime video", "crunchyroll", "spotify"],
        ),
        Category(
            name="Games", color="#d9824a",
            apps=["*-win64-shipping", "*-win64-test", "dwrg", "robloxplayerbeta", "eldenring", "tslgame", "javaw",
                  "brawlhalla", "deadlock", "outerwilds", "risk of rain 2", "ryujinx", "steamwebhelper", "steam",
                  "riot client", "riotclientux", "leagueclient", "league of legends", "cs2", "dota2", "minecraft*",
                  "ittakestwo*", "medal", "epicgameslauncher"],
            keywords=[],
        ),
        Category(
            name="Design", color="#7fb3a0",
            apps=["figma", "photoshop", "illustrator", "blender", "afterfx", "inkscape", "krita"],
            keywords=["figma", "dribbble", "behance"],
        ),
        Category(
            name="Docs", color="#b49bc0",
            apps=["winword", "excel", "powerpnt", "onenote", "notion", "obsidian", "acrobat", "sumatrapdf"],
            keywords=["google docs", "google sheets", "notion.so"],
        ),
        Category(
            name="Browsing", color="#9bab6a",
            apps=["chrome", "msedge", "firefox", "brave", "opera", "arc", "vivaldi"],
            keywords=[],
        ),
    ]
)

DEFAULT_PRIVACY = Privacy(keywords=["Private Browsing", "InPrivate", "Incognito"])

MODELS = {
    "categories": (Categories, DEFAULT_CATEGORIES),
    "privacy": (Privacy, DEFAULT_PRIVACY),
    "accuracy": (Accuracy, Accuracy()),
    "goals": (Goals, Goals()),
}

# Changing these alters how existing history is summarised.
AFFECTS_HISTORY = {"categories", "privacy"}


class Settings:
    """Typed, cached access to settings stored in the database."""

    def __init__(self, store: Store):
        self.store = store
        self._cache: dict[str, BaseModel] = {}
        self._lock = threading.Lock()
        self.listeners: list = []

    def get(self, key: str) -> BaseModel:
        with self._lock:
            if key not in self._cache:
                model, default = MODELS[key]
                raw = self.store.get_setting(key)
                try:
                    self._cache[key] = model.model_validate(raw) if raw is not None else default
                except ValueError:
                    self._cache[key] = default
            return self._cache[key]

    def set(self, key: str, value: BaseModel) -> None:
        self.store.set_setting(key, value.model_dump())
        with self._lock:
            self._cache[key] = value
        if key in AFFECTS_HISTORY:
            self.store.bump_revision()
        for fn in self.listeners:
            fn(key)

    @property
    def categories(self) -> Categories:
        return self.get("categories")  # type: ignore[return-value]

    @property
    def privacy(self) -> Privacy:
        return self.get("privacy")  # type: ignore[return-value]

    @property
    def accuracy(self) -> Accuracy:
        return self.get("accuracy")  # type: ignore[return-value]

    @property
    def goals(self) -> Goals:
        return self.get("goals")  # type: ignore[return-value]
