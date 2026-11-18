# Hearth design system

The single source for every visual decision in `web/`. Tokens live in `web/src/tokens.css` and nothing outside that file uses a raw colour, size or duration.

## Theses (validated 2026-11-16)

**Visual thesis.** A hearth at night: a charred-wood brown-black ground with surfaces one and two steps lighter and warm bone text. Time is drawn as heat on a forge's colour scale, from dull red through cherry and orange to straw-white, so the hours you spent most at the computer glow hottest.
- Ember orange marks actions only.
- Categories use a separate set of earth and mineral tones, so heat never means category.
- Headings and big figures are Fraunces with the soft axis turned up, rounded like worn wood. Everything read is Alegreya Sans, with tabular figures.
- Medium density on an 8px base: one 1200px column with a narrow rail of views on the left, and every section starts on the same left edge.
- Panels are filled rather than outlined, with 14px corners for panels and 6px for controls. There are no drop shadows: depth comes from surfaces getting lighter.

**First screen.** The day as 24 embers, one cell per hour, coloured by minutes active, with the hour under each and the minutes on hover or focus. The row spans the full width with the day's total beside it. On a phone it wraps into two rows of twelve.

**Interaction thesis.** Slow and soft: 200–400ms on one ease-out curve.
- Hovering an hour, app or category heats it one step and cools everything else to 40%, in 200ms.
- Nothing reacts to scrolling.
- Not allowed: springs, bounces, scaling on hover, parallax, scroll reveals, flicker or any looping animation, confetti.

**The one motion.** When a day opens, the embers catch: each hour warms from ash to its colour over 400ms, left to right, 30ms apart. With reduced motion on, the final colours show at once.

**Allowed patterns.** The heat scale; one soft glow, only on the hottest hour and the live "now" marker; tabular figures.

**Set aside.** A KPI-tile grid with a donut; a bare text log; a cabin with brass tools; a leather lounge. Kept: a forge's heat colours.

**Amendment at the design-system step.**
- Bars (apps, sites, averages) are drawn without a grey track. Their length is relative to the largest value shown, and the label says the value.
- The design-system lookup proposed glassmorphism on an OLED blue palette. It contradicts the thesis and was dropped.

**Dials.**
- Variance 3, from "one column, every section on the same left edge, filled panels".
- Motion 2, from "slow and soft, nothing reacts to scrolling, no loops".
- Density 5, from "medium density on an 8px base".

## Colour

| Token | Hex | Role |
|---|---|---|
| `--ground` | `#1a120f` | Page background (charred wood) |
| `--surface` | `#241915` | Panels |
| `--raised` | `#30221c` | Controls and inputs on a panel; hover fill |
| `--line` | `#4a3730` | Dividers where tracking across columns needs them |
| `--edge` | `#86695c` | Input and toggle borders (3.1:1 on raised, 3.4:1 on surface) |
| `--muted` | `#b29d90` | Secondary text (6.6:1 on surface, 5.9:1 on raised) |
| `--text` | `#f3e6d8` | Primary text (14.0:1 on surface) |
| `--action` | `#f0812a` | Buttons, links, focus. Text on it is `--ground`. |
| `--danger` | `#e86a52` | Destructive confirmation and error text (4.8:1 on raised; ground text on it 5.8:1) |

**Heat scale.** Amounts of time only, never category.

| Step | Hex | Hour (minutes active) | Day (hours active) |
|---|---|---|---|
| `--h0` | `#3a2a24` | 0 | 0 |
| `--h1` | `#6e2219` | 1–10 | under 1 |
| `--h2` | `#a8301c` | 11–20 | 1–2 |
| `--h3` | `#d9541e` | 21–30 | 2–4 |
| `--h4` | `#f0812a` | 31–40 | 4–6 |
| `--h5` | `#f7b34a` | 41–50 | 6–8 |
| `--h6` | `#fde3a0` | 51–60 | 8 or more |

**Categories.** These are the defaults, stored in settings, so you can change them in the app.

| Category | Hex |
|---|---|
| Code | `#8fa0c8` smoke blue |
| Games | `#d9824a` copper |
| Browsing | `#9bab6a` moss |
| Communication | `#d8b25a` ochre |
| Media | `#d98a8a` clay |
| Design | `#7fb3a0` verdigris |
| Docs | `#b49bc0` plum ash |
| Other | `#8a7d76` ash |

## Type

- **Display:** `"Fraunces Variable"`, with `font-variation-settings: "SOFT" 100` and weight 560. Fallback: `"Iowan Old Style", Georgia, serif`. Used for page titles, section titles and big figures. Bundled with `@fontsource-variable/fraunces` (full axes).
- **Code:** `--mono`, the system's Cascadia Mono or Consolas, only for file paths and addresses the reader has to type.
- **Body:** `"Alegreya Sans"` 400/500/700. Fallback: `"Segoe UI", system-ui, sans-serif`. Used for everything else. `font-variant-numeric: tabular-nums` applies wherever figures line up.

| Token | Size / line height | Use |
|---|---|---|
| `--fs-figure` | 56 / 1 | The day's total |
| `--fs-page` | 36 / 1.1 | Page title (the date) |
| `--fs-section` | 24 / 1.2 | Section titles |
| `--fs-body` | 17 / 1.5 | Body |
| `--fs-small` | 15 / 1.4 | Secondary |
| `--fs-tiny` | 13 / 1.3 | Hour labels, axis labels |

## Space, corners, depth

- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64 (`--s1` … `--s8`).
- **Corners:** `--r-mark` 3px (bars, heat cells, timeline blocks), `--r-control` 6px, `--r-tile` 10px, `--r-panel` 14px. Pills are not used. Round dots (status, live) are circles.
- **Depth:** no shadows. Ground, then surface, then raised. The only glow is `--glow`, on the hottest hour and the live marker.

## Motion

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(0.22, 0.61, 0.36, 1)` | Every animation |
| `--t-hover` | 200ms | Hover heat and dimming |
| `--t-ui` | 300ms | Popovers, toasts, view swaps |
| `--t-catch` | 400ms | The embers catching (per cell) |
| `--stagger` | 30ms | Between embers |

The catch fades an ash layer over each cell from opacity 1 to 0, so only opacity animates. With `prefers-reduced-motion`, every animation and transition is off.

## Mark

A three-layer flame burning on a log, in a charred tile: `--h3` outside, `--h4` in the middle, `--h6` at the core, on an `--h1` log with an `--h2` cut end, in a `--surface` tile with 8/32 corners. The paths live in `backend/hearth/icon.py`, which draws the tray icon and the shortcut `.ico`. `web/src/assets/favicon.svg` and `web/src/components/Mark.tsx` are generated from the same paths.

- **Tray states.** Recording: lit. Paused and watchers off: the same shape in ash, the fire out. Error: lit, with a `--danger` dot in the corner.
- **Small sizes.** Checked at 16, 24, 32 and 48px on dark, light and grey taskbars. The tile keeps it legible on light ones.

## Components

- **Button:** primary is filled `--action` with `--ground` text. Quiet is `--raised` with `--text`. Danger appears only inside a confirmation. Radius `--r-control`, 40px tall.
- **Input:** `--raised` fill with an `--edge` border; on focus the border turns `--action` and the `--h5` focus outline shows.
- **Panel:** `--surface` fill, `--r-panel` corners, 24–28px padding, no border.
- **Bar:** a category-coloured fill, 6px tall, with no track.
- **Focus:** a 2px `--h5` outline with a 2px offset, on everything that can be focused.
- **Goal progress:** the one bar with a track, because the track is the goal itself (the limit or target). The fill uses the heat colour for limits (hotter as you near it) and the category colour for targets.
- **Stacked row:** a period's time split by category (days of a week, months of a year). 10px tall so the segments read, 1px gaps between segments, no track.
- **Heat cell:** a day in the month calendar or year grid, filled with its heat step. Days still to come are drawn as an outline only.
- **App icon:** the app's own icon, read from its executable, `--r-mark` corners, never recoloured. Apps Hearth hasn't seen running get a `--raised` tile with their first letter in the category colour. 18px in bar lists, 28–32px in search hits and the timeline detail, 56px in the app page header.
- **App link:** an app's name anywhere (bar lists, timeline detail, search, settings) links to its page. In bar lists it keeps the `--text` colour and underlines in `--h5` on hover, so the lists don't turn orange.
- **Category mark:** a 56px `--raised` tile with the category's initial in its colour and a 6px band of that colour along the bottom, heading the category page. Category names link to that page wherever they're listed.
- **Share strip:** how a whole splits between its parts (a category's time between its apps): one 10px row of segments 2px apart in a single colour, fading by rank.
- **Segmented control:** `.seg` groups toggles 4px apart. The chosen one is `--raised` with `--text`, whether it's a pressed button or the current link.

## Direction: Material (branch `design/material`)

The Hearth atmosphere with real surfaces. Everything above still holds, except where this section says otherwise.

- **Surfaces.** Panels carry a long horizontal wood grain and the rail a vertical one; the ground carries a fine ash speckle; heat cells, bars and stacked rows carry a dark coal mottling. All are SVG noise baked to under 10% alpha (`--tex-wood`, `--tex-wood-v`, `--tex-ash`, `--tex-coal` in `web/src/material.css`), so text contrast moves by less than 0.2:1.
- **Edge.** Panels get a 1px light top edge (`--edge-light`), like light catching a board. Still no drop shadows.
- **Amendment to the interaction thesis.** One loop is allowed: the live "now" dot and marker flicker like a small flame, on irregular steps (`--t-flicker` 3.4s) so it never reads as a pulse. Reduced motion stops it.
- **Fills** are set with `background-color`, never the `background` shorthand, so textures layer over them.
