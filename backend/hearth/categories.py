"""Sort activity into categories and apply privacy rules, both driven by settings.

App patterns match the executable name without `.exe`, case-insensitively, and may use `*`.
Keywords match anywhere in the window title or the website's domain. Keyword rules are checked
first (in category order), so a browser tab on GitHub counts as Code and one on YouTube as Media.
"""

from __future__ import annotations

from fnmatch import fnmatchcase

from .settings import Categories, Privacy

# System surfaces that never count as using an app.
IGNORED_APPS = {"lockapp", "logonui", "screenclippinghost"}

PRIVATE_APP = "Private"


def app_key(app: str) -> str:
    app = (app or "").lower()
    return app[:-4] if app.endswith(".exe") else app


def _matches(patterns: list[str], key: str) -> bool:
    return any(fnmatchcase(key, p) for p in patterns)


class Categorizer:
    def __init__(self, cats: Categories):
        self.keyword_rules = [(c.name, [k.lower() for k in c.keywords]) for c in cats.categories if c.keywords]
        self.app_rules = [(c.name, [app_key(a) for a in c.apps]) for c in cats.categories if c.apps]
        self.colors = {c.name: c.color for c in cats.categories}
        self.colors["Other"] = cats.other_color
        self._cache: dict[tuple[str, str, str], str] = {}

    def __call__(self, app: str, title: str, domain: str = "") -> str:
        key = (app, title, domain)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        hay = f"{title}\n{domain}".lower()
        result = "Other"
        for name, kws in self.keyword_rules:
            if any(k in hay for k in kws):
                result = name
                break
        else:
            k = app_key(app)
            for name, pats in self.app_rules:
                if _matches(pats, k):
                    result = name
                    break
        if len(self._cache) < 200_000:
            self._cache[key] = result
        return result

    def app_category(self, app: str) -> str | None:
        k = app_key(app)
        for name, pats in self.app_rules:
            if _matches(pats, k):
                return name
        return None


class PrivacyFilter:
    """Hides excluded apps entirely and blanks titles that contain an excluded keyword."""

    def __init__(self, privacy: Privacy):
        self.apps = [app_key(a) for a in privacy.apps]
        self.keywords = [k.lower() for k in privacy.keywords]

    def apply(self, data: dict) -> dict:
        app = data.get("app") or ""
        if self.apps and _matches(self.apps, app_key(app)):
            return {"app": PRIVATE_APP, "title": ""}
        hay = f"{data.get('title') or ''}\n{data.get('url') or ''}\n{data.get('domain') or ''}".lower()
        if self.keywords and any(k in hay for k in self.keywords):
            out = {k: v for k, v in data.items() if k not in ("title", "url", "domain")}
            out["title"] = ""
            out["private"] = True
            return out
        return data
