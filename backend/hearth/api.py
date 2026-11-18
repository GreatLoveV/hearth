"""HTTP API and static UI hosting.

Hearth only listens on 127.0.0.1, but any website you visit can still try to reach it.
These protections keep other sites from reading your history or changing settings:
- Host must be localhost or 127.0.0.1, which blocks DNS-rebinding attacks.
- Requests that change things must come from the dashboard itself, from a local program
  (no Origin header), or, for recording endpoints only, from a browser extension.
- No CORS headers are sent, so other origins can't read responses.
- Request bodies are size-limited and validated; responses carry a strict CSP.
"""

from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError, Field

from . import __version__
from .appdetail import build_app
from .appinfo import Icons
from .categories import IGNORED_APPS, PrivacyFilter, app_key
from .db import SYSTEM_APP, Store
from .resources import EVERY, summarize
from .goals import goal_status
from .maintenance import backups, export_csv, export_json
from .search import search
from .settings import MODELS, Settings
from .summary import WEB_TYPE, Reader, build_range, build_summary

WEB_DIST = Path(__file__).resolve().parents[2] / "web" / "dist"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
EXTENSION_SCHEMES = {"moz-extension", "chrome-extension"}
BUCKET_TYPES = {"currentwindow", "afkstatus", WEB_TYPE}
BUCKET_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,120}$")
MAX_BODY = 256 * 1024
MAX_FIELD = 2000

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)


@dataclass
class Runtime:
    paused: threading.Event = field(default_factory=threading.Event)
    health: dict[str, float] = field(default_factory=dict)
    watchers: bool = False
    started: float = field(default_factory=time.time)
    monitor: object | None = None  # resources.ResourceMonitor when the watchers run

    def status(self) -> dict:
        now = time.time()
        ages = {k: now - v for k, v in self.health.items()}
        stale = [k for k in ("window", "afk") if self.watchers and ages.get(k, 1e9) > 30 and now - self.started > 30]
        state = "off" if not self.watchers else "paused" if self.paused.is_set() else "error" if stale else "recording"
        return {"state": state, "stale": stale, "watcher_ages": ages}


class BucketIn(BaseModel):
    type: str
    hostname: str = Field(max_length=200)


class HeartbeatIn(BaseModel):
    timestamp: float
    data: dict


class PauseIn(BaseModel):
    paused: bool


class ForgetIn(BaseModel):
    start: float
    end: float


def _origin_ok(origin: str, path: str) -> bool:
    try:
        parts = urlsplit(origin)
    except ValueError:
        return False
    if parts.scheme in ("http", "https") and parts.hostname in LOCAL_HOSTS:
        return True
    return parts.scheme in EXTENSION_SCHEMES and path.startswith("/api/buckets/")


def _clean_data(data: dict) -> dict:
    if len(json.dumps(data)) > 8000:
        raise HTTPException(413, "Event data is too large.")
    return {
        str(k)[:60]: (v[:MAX_FIELD] if isinstance(v, str) else v)
        for k, v in data.items()
        if isinstance(v, (str, int, float, bool)) or v is None
    }


SINGULAR = {"categories": "category", "goals": "goal", "apps": "app", "keywords": "keyword", "days": "day"}


def _friendly(e: ValidationError) -> str:
    """One short sentence per problem, e.g. 'Category 1, name: String should have at least 1 character'."""
    parts = []
    for err in e.errors()[:3]:
        loc = [str(x) for x in err["loc"]]
        words = []
        for i, x in enumerate(loc):
            if x.isdigit() and i:
                words[-1] = f"{SINGULAR.get(words[-1], 'item')} {int(x) + 1}"
            else:
                words.append(x.replace("_", " "))
        parts.append(f"{', '.join(words).capitalize()}: {err['msg']}" if words else err["msg"])
    return ". ".join(parts) + "."


def _parse_day(s: str) -> date:
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(400, f"{s!r} is not a date. Use YYYY-MM-DD.") from None


def create_app(store: Store, settings: Settings, runtime: Runtime) -> FastAPI:
    app = FastAPI(title="Hearth", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    reader = Reader(store, settings)
    icons = Icons(store)

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
        if host not in LOCAL_HOSTS:
            return JSONResponse({"detail": "Hearth only answers on localhost."}, status_code=421)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            origin = request.headers.get("origin")
            if origin is not None and not _origin_ok(origin, request.url.path):
                return JSONResponse({"detail": "Requests from other websites aren't allowed."}, status_code=403)
            if int(request.headers.get("content-length") or 0) > MAX_BODY:
                return JSONResponse({"detail": "Request body is too large."}, status_code=413)
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
        path = request.url.path
        if path.startswith("/api/apps/") and path.endswith("/icon"):
            # Icons rarely change; a missing one is retried after a while, once the app has run.
            response.headers["Cache-Control"] = "private, max-age=86400" if response.status_code == 200 else "private, max-age=600"
        elif path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        elif path.startswith("/assets/"):
            # Built files are named by their content, so a new build always gets new URLs.
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        else:
            # The page itself (and favicon.ico) is checked on every load, so it always points at the latest build.
            response.headers["Cache-Control"] = "no-cache"
        return response

    # Status ----------------------------------------------------------------------

    @app.get("/api/health")
    def health():
        return {"ok": True, "version": __version__}

    @app.get("/api/status")
    def status():
        b = backups()
        return {
            **runtime.status(),
            "version": __version__,
            "db_path": str(store.path),
            "db_bytes": store.size_bytes(),
            "last_backup": {"path": str(b[-1]), "bytes": b[-1].stat().st_size,
                            "time": b[-1].stat().st_mtime} if b else None,
            "backup_count": len(b),
        }

    @app.post("/api/pause")
    def pause(body: PauseIn):
        if body.paused:
            runtime.paused.set()
        else:
            runtime.paused.clear()
        return runtime.status()

    # Recording -------------------------------------------------------------------

    @app.get("/api/buckets")
    def list_buckets():
        return store.buckets()

    @app.post("/api/buckets/{bucket_id}")
    def create_bucket(bucket_id: str, body: BucketIn):
        if not BUCKET_ID.match(bucket_id) or body.type not in BUCKET_TYPES:
            raise HTTPException(400, "Unknown bucket type or invalid bucket id.")
        store.ensure_bucket(bucket_id, body.type, body.hostname)
        return {"id": bucket_id}

    @app.post("/api/buckets/{bucket_id}/heartbeat")
    def heartbeat(bucket_id: str, body: HeartbeatIn, pulsetime: float = Query(2.0, ge=0, le=600)):
        if not store.bucket_exists(bucket_id):
            raise HTTPException(404, f"Bucket {bucket_id} does not exist. Create it first.")
        if runtime.paused.is_set():
            return {"paused": True}
        if abs(body.timestamp - time.time()) > 3600:
            raise HTTPException(400, "Timestamp is more than an hour away from now.")
        data = _clean_data(body.data)
        if data.get("incognito"):
            data = {"browser": data.get("browser", ""), "private": True}
        else:
            data = PrivacyFilter(settings.privacy).apply(data)
        return store.heartbeat(bucket_id, body.timestamp, data, pulsetime).to_dict()

    @app.get("/api/buckets/{bucket_id}/events")
    def events(bucket_id: str, start: float, end: float):
        return [e.to_dict() for e in store.events(bucket_id, start, end)]

    # Reading ---------------------------------------------------------------------

    @app.get("/api/summary")
    def summary(start: float, end: float):
        if not 0 < end - start <= 3 * 86400:
            raise HTTPException(400, "end must be after start, and at most 3 days later.")
        return build_summary(store, reader, start, end, time.time())

    @app.get("/api/range")
    def range_(start: str, end: str):
        first, last = _parse_day(start), _parse_day(end)
        if not 0 <= (last - first).days <= 400:
            raise HTTPException(400, "The range must run forward and cover at most 400 days.")
        return build_range(store, reader, first, last, time.time())

    @app.get("/api/goals/status")
    def goals_status(day: str | None = None):
        return goal_status(reader, settings, _parse_day(day) if day else date.today())

    @app.get("/api/apps")
    def all_apps():
        reader.refresh()
        out = []
        for app_name, seconds in store.app_totals():
            if not app_name or app_key(app_name) in IGNORED_APPS:
                continue
            out.append({"app": app_name, "seconds": seconds, "category": reader.categorize.app_category(app_name)})
        return out[:400]

    @app.get("/api/search")
    def search_(q: str = Query(min_length=2, max_length=200)):
        return search(store, reader, q)

    # One app ----------------------------------------------------------------------

    @app.get("/api/app")
    def app_detail(name: str = Query(min_length=1, max_length=200), start: str = "", end: str = ""):
        first, last = _parse_day(start), _parse_day(end)
        if not 0 <= (last - first).days <= 400:
            raise HTTPException(400, "The range must run forward and cover at most 400 days.")
        every = getattr(runtime.monitor, "every", EVERY)
        return build_app(store, reader, name, first, last, time.time(), every)

    @app.get("/api/apps/{name}/icon")
    def app_icon(name: str):
        if len(name) > 200:
            raise HTTPException(404, "No icon.")
        png = icons.png(name)
        if png is None:
            raise HTTPException(404, "No icon for this app yet. It appears once the app has run while Hearth is open.")
        return Response(png, media_type="image/png")

    # Resources --------------------------------------------------------------------

    @app.get("/api/resources")
    def resources(start: float, end: float):
        if not 0 < end - start <= 400 * 86400:
            raise HTTPException(400, "end must be after start, and at most 400 days later.")
        every = getattr(runtime.monitor, "every", EVERY)
        per_app = summarize(store.usage(start, end), every)
        system = per_app.pop(SYSTEM_APP, None)
        reader.refresh()
        apps = [{"key": k, "category": reader.categorize.app_category(k) or "Other", **v}
                for k, v in per_app.items() if k not in IGNORED_APPS and not reader.privacy.hides_app(k)]
        apps.sort(key=lambda a: -a["mem_avg"])
        return {"apps": apps[:60], "system": system, "every": every, "colors": reader.colors}

    @app.get("/api/resources/now")
    def resources_now():
        latest = getattr(runtime.monitor, "latest", None)
        if not latest:
            return {"available": False}
        apps = [{**a, "key": app_key(a["app"])} for a in latest["apps"][:60]]
        return {"available": True, **latest, "apps": apps}

    # Settings and data -------------------------------------------------------------

    @app.get("/api/settings/{key}")
    def get_setting(key: str):
        if key not in MODELS:
            raise HTTPException(404, "Unknown setting.")
        return settings.get(key).model_dump()

    @app.put("/api/settings/{key}")
    async def put_setting(key: str, request: Request):
        if key not in MODELS:
            raise HTTPException(404, "Unknown setting.")
        model, _ = MODELS[key]
        try:
            value = model.model_validate(await request.json())
        except ValidationError as e:
            raise HTTPException(422, _friendly(e)) from None
        except ValueError:
            raise HTTPException(422, "That isn't valid JSON.") from None
        settings.set(key, value)
        return value.model_dump()

    @app.post("/api/forget")
    def forget(body: ForgetIn):
        if not 0 < body.end - body.start <= 400 * 86400:
            raise HTTPException(400, "Pick a range that ends after it starts.")
        return {"changed": store.forget(body.start, body.end)}

    @app.get("/api/export")
    def export(
        format: Literal["csv", "json"] = "csv",
        start: str | None = None,
        end: str | None = None,
    ):
        lo = datetime.combine(_parse_day(start), datetime.min.time()).timestamp() if start else 0.0
        hi = (datetime.combine(_parse_day(end), datetime.min.time()) + timedelta(days=1)).timestamp() if end else time.time() + 86400
        gen = export_csv(store, lo, hi) if format == "csv" else export_json(store, lo, hi)
        name = f"hearth-{start or 'all'}-{end or date.today().isoformat()}.{format}"
        media = "text/csv; charset=utf-8" if format == "csv" else "application/json"
        return StreamingResponse(gen, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})

    if WEB_DIST.is_dir():
        app.mount("/", StaticFiles(directory=WEB_DIST, html=True), name="web")

    return app
