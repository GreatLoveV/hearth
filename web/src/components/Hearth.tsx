import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { CategoryRow, Colors } from "../api";
import { colorOf, fmtDuration } from "../lib";
import { categoryHref } from "../router";

/**
 * The day as a hearth: one log per category, sized by its time, and a fire whose height
 * follows the day's total. Every lit fire moves; while it's "live" (today and active) it burns
 * faster and throws sparks. Each log links to its category's page for the day's month.
 */

const W = 400;
const H = 360;
const FLOOR = 330;
const ARCH = `M 40 ${FLOOR} V 120 Q 40 40 200 40 Q 360 40 360 120 V ${FLOOR}`;
const FULL_DAY = 6 * 3600; // the fire reaches full height at six active hours

type Log = { name: string; seconds: number; r: number; x: number; y: number };
type Circle = { x: number; y: number; r: number };

const GROUND = FLOOR - 6; // the bottom row of logs rests on this line

/** Where a log of radius r settles on two logs below it: touching both, in the dip between them. */
function restOn(a: Circle, b: Circle, r: number): { x: number; y: number } {
  const ra = a.r + r;
  const rb = b.r + r;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const along = (ra * ra - rb * rb + d * d) / (2 * d);
  const up = Math.sqrt(Math.max(0, ra * ra - along * along));
  const mx = a.x + (dx * along) / d;
  const my = a.y + (dy * along) / d;
  const one = { x: mx + (dy * up) / d, y: my - (dx * up) / d };
  const two = { x: mx - (dy * up) / d, y: my + (dx * up) / d };
  return one.y < two.y ? one : two;
}

/**
 * The categories as a pile of logs that could really stand. The bottom row lies on the hearth with
 * each log touching the next; every log above sits in the dip between two logs below, touching both.
 * Biggest at the bottom, in the middle.
 */
function stack(cats: CategoryRow[]): Log[] {
  const top = cats.filter((c) => c.seconds > 60).slice(0, 6);
  if (!top.length) return [];
  const max = top[0].seconds;
  const sized = top.map((c) => ({ name: c.name, seconds: c.seconds, r: 13 + 15 * Math.sqrt(c.seconds / max) }));
  const rows = [[1], [2], [2, 1], [3, 1], [3, 2], [3, 2, 1]][sized.length - 1];

  // Bottom row: on the floor, touching. Two circles on one line touch when their centres are 2·√(r1·r2) apart.
  const firstRow = sized.slice(0, rows[0]);
  const bottomOrder = firstRow.length === 3 ? [firstRow[1], firstRow[0], firstRow[2]] : firstRow;
  const below: Log[] = [];
  bottomOrder.forEach((l, k) => {
    const x = k === 0 ? 0 : below[k - 1].x + 2 * Math.sqrt(below[k - 1].r * l.r);
    below.push({ ...l, x, y: GROUND - l.r });
  });
  const shift = W / 2 - (below[0].x - below[0].r + below[below.length - 1].x + below[below.length - 1].r) / 2;
  below.forEach((l) => (l.x += shift));

  const logs: Log[] = [...below];
  let lower = below;
  let i = rows[0];
  for (const count of rows.slice(1)) {
    const items = sized.slice(i, i + count);
    i += count;
    // One log per dip. A single log on a row of three takes the dip beside the biggest log.
    const dips = count === lower.length - 1 ? items.map((_, k) => k) : [0];
    const row = items.map((l, k) => {
      const at = restOn(lower[dips[k]], lower[dips[k] + 1], l.r);
      // If the dip is wide enough to swallow it, it stops on whatever log it reaches first instead.
      for (const q of logs) {
        const dx = at.x - q.x;
        const reach = l.r + q.r;
        if (Math.abs(dx) < reach) at.y = Math.min(at.y, q.y - Math.sqrt(reach * reach - dx * dx));
      }
      const placed = { ...l, ...at };
      logs.push(placed);
      return placed;
    });
    lower = row;
  }
  return logs;
}

/**
 * The fire is the Hearth mark's flame (components/Mark.tsx), drawn big: the same three layers, each
 * rooted on the hearth floor behind the logs, so the outer flame's round bottom wraps the pile.
 * Each path is in the mark's 32-unit box; `box` is its left, top, right and bottom there.
 * `w` and `h` size it against the outer flame and the fire's height. `delay` is when it catches:
 * the hot core first, the outer flame last.
 */
const FLAMES = [
  {
    d: "M16 3.5C19.5 8.5 25.5 12 25.5 19C25.5 24.8 21.3 28.5 16 28.5C10.7 28.5 6.5 24.8 6.5 19C6.5 14.6 9.4 12.2 11.2 9C12.2 12.3 13.4 13.6 14.8 14.1C15.2 10.4 14.7 6.8 16 3.5Z",
    box: [6.5, 3.5, 25.5, 28.5],
    w: 1,
    h: 1,
    drop: 0,
    fill: "var(--h3)",
    lick: "1.8s",
    delay: 700,
  },
  {
    d: "M16 11.5C18.7 14.8 21.4 17.4 21.4 21.2C21.4 24.5 19 26.6 16 26.6C13 26.6 10.6 24.5 10.6 21.2C10.6 18.6 12.6 17 13.8 15.4C14.4 16.9 15.1 17.6 16 18C16.3 15.9 15.6 13.8 16 11.5Z",
    box: [10.6, 11.5, 21.4, 26.6],
    w: 0.6,
    h: 0.66,
    drop: 4,
    fill: "var(--h4)",
    lick: "1.4s",
    delay: 380,
  },
  {
    d: "M16 18.2C17.8 20.2 18.9 21.7 18.9 23.2C18.9 24.9 17.6 26 16 26C14.4 26 13.1 24.9 13.1 23.2C13.1 21.7 14.2 20.2 16 18.2Z",
    box: [13.1, 18.2, 18.9, 26],
    w: 0.32,
    h: 0.36,
    drop: 6,
    fill: "var(--h6)",
    lick: "1s",
    delay: 100,
  },
];

/** Place a mark-box path with its bottom centre at (x, base), w wide and h tall. */
function placeFlame(box: number[], x: number, base: number, w: number, h: number): string {
  const [l, t, r, b] = box;
  return `translate(${x} ${base}) scale(${w / (r - l)} ${h / (b - t)}) translate(${-(l + r) / 2} ${-b})`;
}

export function Hearth({
  categories,
  total,
  colors,
  live,
  recent,
  date,
}: {
  categories: CategoryRow[];
  total: number;
  colors: Colors;
  live: boolean;
  /** Seconds active in the last hour, for how lively the fire is. */
  recent: number;
  /** The day shown, as YYYY-MM-DD: the logs open their category for this day's month. */
  date: string;
}) {
  const [hover, setHoverNow] = useState<string | null>(null);
  // Leaving a log waits a moment before the caption goes back, so crossing the gap between two
  // logs doesn't flash the placeholder. Entering another log cancels the wait.
  const leaving = useRef<number | undefined>(undefined);
  const setHover = (name: string | null) => {
    window.clearTimeout(leaving.current);
    if (name !== null) setHoverNow(name);
    else leaving.current = window.setTimeout(() => setHoverNow(null), 160);
  };
  useEffect(() => () => window.clearTimeout(leaving.current), []);
  const logs = stack(categories);
  const pileTop = logs.length ? Math.min(...logs.map((l) => l.y - l.r)) : FLOOR - 20;
  // Where the flames show above the pile. They burn up from the embers on the hearth floor, behind
  // the logs, so each one reaches down to `root` and shows through the gaps between the logs.
  const base = pileTop + 18;
  const root = FLOOR - 4;
  const depth = root - base;
  const size = Math.min(1, total / FULL_DAY);
  const fh = total > 60 ? 30 + (base - 95 - 30) * size : 0; // a full day reaches y = 95, well inside the arch
  const pileL = logs.length ? Math.min(...logs.map((l) => l.x - l.r)) : W / 2 - 40;
  const pileR = logs.length ? Math.max(...logs.map((l) => l.x + l.r)) : W / 2 + 40;
  const pileW = pileR - pileL;
  // How wide the outer flame is: its round bottom wraps the pile, a little wider on longer days.
  const fw = (pileW + 24) * (1.05 + 0.2 * size);
  const cx = W / 2;
  const lively = live && recent > 120;
  const shown = hover ? logs.find((l) => l.name === hover) : null;
  const label =
    total > 60
      ? `A fire for ${fmtDuration(total)} of activity, on logs for ${logs
          .map((l) => `${l.name} ${fmtDuration(l.seconds)}`)
          .join(", ")}.`
      : "A cold hearth: nothing recorded yet.";

  return (
    <figure className="hearth" data-lit={fh > 0 || undefined} data-live={lively || undefined}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <radialGradient id="hearth-glow" cx="50%" cy="100%" r="70%">
            <stop offset="0%" stopColor="var(--h4)" stopOpacity={0.28 * size + 0.08} />
            <stop offset="100%" stopColor="var(--h4)" stopOpacity="0" />
          </radialGradient>
          <clipPath id="hearth-box">
            <path d={`${ARCH} Z`} />
          </clipPath>
        </defs>

        {/* Firebox */}
        <path className="hearth-arch" d={ARCH} />
        {total > 60 && (
          <ellipse
            className="hearth-light"
            cx={cx}
            cy={base}
            rx={150}
            ry={base - 40}
            fill="url(#hearth-glow)"
            clipPath="url(#hearth-box)"
          />
        )}
        <rect className="hearth-floor" x="20" y={FLOOR} width={W - 40} height="14" rx="3" />
        <ellipse className="hearth-ash" cx={cx} cy={FLOOR - 2} rx="120" ry="8" />
        {/* Embers under the logs: they glow first, and the fire catches from them. */}
        {fh > 0 && <ellipse className="embers" cx={cx} cy={FLOOR - 4} rx={60 + 50 * size} ry="5" />}

        {/* Fire, back to front */}
        {fh > 0 && (
          <g className="fire" clipPath="url(#hearth-box)" style={{ "--o": `${cx}px ${root}px` } as CSSProperties}>
            {FLAMES.map((f, k) => (
              // Outer group: the catch, growing out of the floor under the logs. Middle group: the flicker.
              <g key={k} className="flame-catch" style={{ "--delay": `${f.delay}ms` } as CSSProperties}>
                <g className="flame" style={{ "--d": f.lick, "--start": `${f.delay + 900}ms` } as CSSProperties}>
                  <path d={f.d} fill={f.fill} transform={placeFlame(f.box, cx, root - f.drop, fw * f.w, (depth + fh) * f.h)} />
                </g>
              </g>
            ))}
          </g>
        )}
        {lively &&
          [0, 1, 2, 3, 4].map((k) => (
            <circle
              key={k}
              className="spark"
              cx={cx - 30 + k * 15}
              cy={base - fh * 0.6}
              r={1.6}
              style={{ "--k": k } as CSSProperties}
            />
          ))}

        {/* Logs, seen end-on */}
        <g className="logs">
          {logs.map((l) => (
            <a
              key={l.name}
              href={categoryHref(l.name, "month", date.slice(0, 7))}
              className="log"
              aria-label={`${l.name}, ${fmtDuration(l.seconds)}. Open the ${l.name} page.`}
              data-dim={(hover !== null && hover !== l.name) || undefined}
              onMouseEnter={() => setHover(l.name)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(l.name)}
              onBlur={() => setHover(null)}
            >
              <circle cx={l.x} cy={l.y} r={l.r} className="log-bark" />
              <circle cx={l.x} cy={l.y} r={l.r - 3.5} fill={colorOf(colors, l.name)} />
              <circle cx={l.x} cy={l.y} r={(l.r - 3.5) * 0.66} className="log-ring" />
              <circle cx={l.x} cy={l.y} r={(l.r - 3.5) * 0.33} className="log-ring" />
            </a>
          ))}
        </g>
      </svg>
      <figcaption className="hearth-caption" aria-hidden="true">
        {shown ? (
          <>
            <span className="swatch" style={{ background: colorOf(colors, shown.name) }} />
            <strong>{shown.name}</strong> {fmtDuration(shown.seconds)}
            <span>, click to open</span>
          </>
        ) : logs.length ? (
          "One log per category, sized by its time. Hover one, or click it to open the category."
        ) : (
          "The fire's laid. It catches once you're active."
        )}
      </figcaption>
    </figure>
  );
}
