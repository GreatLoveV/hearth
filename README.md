# Hearth

A private, local time tracker for Windows, modelled on ActivityWatch. It records the active window, whether you're at the computer and, with the Firefox extension, the open tab. Everything stays in a local SQLite file, and a dashboard at http://127.0.0.1:5600 shows it.

## What the dashboard has

- **Day:** the 24 hours on a heat scale, a timeline you can pin blocks on (and forget one), apps, categories, goals, sites and window titles. Left and right arrow keys move between days.
- **Week, Month, Year:** days by category, a month calendar and a year grid, an average day, weekday averages and the change from the period before.
- **Search:** every window title, app and site in your history, with the days each one appears on.
- **Settings:**
  - **Tracking:** pause recording, and choose what counts as active (full-screen apps, media playing sound, controller input, how many minutes without input count as away).
  - **Categories:** edit categories and assign the apps that have none.
  - **Goals:** daily limits and targets, with tray notifications.
  - **Privacy:** apps kept private and words that hide a title.
  - **Your data:** backups, CSV and JSON export, and forgetting a stretch of time.

The design system behind the UI is in `MASTER.md`.

## Layout

- `backend/hearth/` contains the Python package:
  - `db.py`: SQLite store for buckets and events, and heartbeat merging
  - `watchers.py`: the active-window and AFK watchers (Windows, via ctypes), with full-screen, audio and controller detection
  - `settings.py`: categories, privacy, accuracy and goals, stored in the database and editable from the UI
  - `goals.py`, `search.py`, `maintenance.py`: goal status and notifications, history search, backups and export
  - `summary.py`: turns raw events into the day summary the UI shows
  - `categories.py`: rules that sort apps and window titles into categories
  - `api.py`: the FastAPI REST API, which also serves the built UI
  - `seed.py`: writes sample days into a separate database, for UI work
- `web/` is the dashboard (Vite, React and TypeScript).
- `extensions/firefox/` is the tab-tracking extension. Its README explains how to install it.

## Run it

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cd ../web && npm install && npm run build && cd ../backend
.venv/Scripts/python -m hearth
```

Open http://127.0.0.1:5600. Your data is stored in `~/.hearth/hearth.db`. Set `--db` or `HEARTH_DB` to change the location.

## Shortcut and tray icon

```bash
.venv/Scripts/python -m hearth.install
```

This creates **Hearth** shortcuts on the desktop and in the Start menu. Clicking one starts Hearth without a console window, adds a tray icon and opens the dashboard. If Hearth is already running, clicking just opens the dashboard.

The tray icon has three menu items:
- **Open dashboard** (also on left-click)
- **Pause recording**
- **Quit Hearth**

In tray mode, logs go to `~/.hearth/hearth.log`.

To make Hearth start when you log in, add `--autostart`. To stop that, use `--no-autostart`.

## Import from ActivityWatch

With ActivityWatch running:

```bash
.venv/Scripts/python -m hearth.import_aw
```

This copies its window, AFK and other buckets into `aw-import-…` buckets. The import stops where Hearth's own recording begins, so no time is counted twice. Running it again replaces the earlier import.

## Work on the UI

To use sample data instead of your real history:

```bash
cd backend
.venv/Scripts/python -m hearth.seed --db demo.db
.venv/Scripts/python -m hearth --db demo.db --no-watchers
```

For hot reload, run `npm run dev` in `web/`. It proxies `/api` to port 5600.

The screenshot and flow checks use Playwright, which isn't needed to run Hearth:

```bash
.venv/Scripts/python -m pip install playwright
.venv/Scripts/python -m playwright install chromium
```

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/buckets` | List buckets |
| POST | `/api/buckets/{id}` | Create a bucket `{type, hostname}` |
| POST | `/api/buckets/{id}/heartbeat?pulsetime=2` | Send a heartbeat `{timestamp, data}` |
| GET | `/api/buckets/{id}/events?start&end` | Get raw events (epoch seconds) |
| GET | `/api/summary?start&end` | Get the day summary used by the dashboard |
| GET | `/api/range?start&end` | Get a period summary (dates as `YYYY-MM-DD`, up to 400 days) |
| GET | `/api/search?q` | Search titles, apps and sites |
| GET | `/api/app?name&start&end` | Get one app's history for a period (dates, up to 400 days) |
| GET | `/api/apps/{name}/icon` | Get the app's icon as a PNG, read from its executable |
| GET | `/api/resources?start&end` | Get average and peak processor, memory and disk per app (epoch seconds) |
| GET | `/api/resources/now` | Get the latest resource sample |
| GET | `/api/goals/status?day` | Get each goal's progress for a day |
| GET | `/api/status` | Get the recording state, database size and backups |
| POST | `/api/pause` | Pause or resume `{paused}` |
| GET, PUT | `/api/settings/{categories,privacy,accuracy,goals}` | Read or replace a group of settings |
| POST | `/api/forget` | Delete everything between `{start, end}` |
| GET | `/api/export?format=csv|json&start&end` | Download events |

The API only answers on 127.0.0.1 and localhost, and refuses changes sent from other websites.

A heartbeat extends the bucket's latest event when its data is identical and it arrives within `pulsetime` seconds of that event's end. Otherwise it starts a new event. To add an external watcher, create a bucket and post heartbeats to it.
