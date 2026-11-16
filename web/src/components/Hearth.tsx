import { useState, type CSSProperties } from "react";
import type { CategoryRow, Colors } from "../api";
import { colorOf, fmtDuration } from "../lib";

/**
 * The day as a hearth: one log per category, sized by its time, and a fire whose height
 * follows the day's total. The fire moves only while it is "live" (today and active).
 */

const W = 400;
const H = 360;
const FLOOR = 330;
const ARCH = `M 40 ${FLOOR} V 120 Q 40 40 200 40 Q 360 40 360 120 V ${FLOOR}`;
const FULL_DAY = 6 * 3600; // the fire reaches full height at six active hours

type Log = { name: string; seconds: number; r: number; x: number; y: number };

function stack(cats: CategoryRow[]): Log[] {
  const top = cats.filter((c) => c.seconds > 60).slice(0, 6);
  if (!top.length) return [];
  const max = top[0].seconds;
  const sized = top.map((c) => ({ ...c, r: 13 + 15 * Math.sqrt(c.seconds / max) }));
  const rows = sized.length <= 3 ? [sized.length] : sized.length <= 5 ? [3, sized.length - 3] : [3, 2, 1];
  const logs: Log[] = [];
  let i = 0;
  let prevY = 0;
  let prevR = 0;
  rows.forEach((count, row) => {
    const items = sized.slice(i, i + count);
    i += count;
    // Biggest log in the middle of its row.
    const ordered = items.length === 3 ? [items[1], items[0], items[2]] : items;
    const rowR = Math.max(...ordered.map((l) => l.r));
    const y = row === 0 ? FLOOR - 6 - rowR : prevY - (prevR + rowR) * 0.82;
    const widths = ordered.map((l) => l.r * 2 * 0.96);
    let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
    ordered.forEach((l, k) => {
      logs.push({ name: l.name, seconds: l.seconds, r: l.r, x: x + widths[k] / 2, y: y + (rowR - l.r) });
      x += widths[k];
    });
    prevY = y;
    prevR = rowR;
  });
  return logs;
}

function flame(cx: number, base: number, w: number, h: number): string {
  const l = cx - w / 2;
  const r = cx + w / 2;
  return [
    `M ${l} ${base}`,
    `C ${l} ${base - h * 0.42} ${cx - w * 0.18} ${base - h * 0.58} ${cx} ${base - h}`,
    `C ${cx + w * 0.18} ${base - h * 0.58} ${r} ${base - h * 0.42} ${r} ${base}`,
    "Z",
  ].join(" ");
}

export function Hearth({
  categories,
  total,
  colors,
  live,
  recent,
}: {
  categories: CategoryRow[];
  total: number;
  colors: Colors;
  live: boolean;
  /** Seconds active in the last hour, for how lively the fire is. */
  recent: number;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const logs = stack(categories);
  const pileTop = logs.length ? Math.min(...logs.map((l) => l.y - l.r)) : FLOOR - 20;
  const base = pileTop + 18;
  const size = Math.min(1, total / FULL_DAY);
  const fh = total > 60 ? 36 + (base - 24 - 36) * size : 0;
  const fw = 70 + 70 * size;
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
    <figure className="hearth" data-live={lively || undefined}>
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
        {total > 60 && <ellipse className="hearth-light" cx={cx} cy={base} rx={150} ry={base - 40} fill="url(#hearth-glow)" clipPath="url(#hearth-box)" />}
        <rect className="hearth-floor" x="20" y={FLOOR} width={W - 40} height="14" rx="3" />
        <ellipse className="hearth-ash" cx={cx} cy={FLOOR - 2} rx="120" ry="8" />

        {/* Fire, back to front */}
        {fh > 0 && (
          <g className="fire">
            <path className="flame" style={{ "--d": "2.6s" } as CSSProperties} d={flame(cx - fw * 0.28, base, fw * 0.7, fh * 0.78)} fill="var(--h2)" />
            <path className="flame" style={{ "--d": "2.1s" } as CSSProperties} d={flame(cx + fw * 0.26, base, fw * 0.66, fh * 0.7)} fill="var(--h2)" />
            <path className="flame" style={{ "--d": "1.8s" } as CSSProperties} d={flame(cx, base, fw, fh)} fill="var(--h3)" />
            <path className="flame" style={{ "--d": "1.4s" } as CSSProperties} d={flame(cx - fw * 0.06, base, fw * 0.62, fh * 0.72)} fill="var(--h4)" />
            <path className="flame" style={{ "--d": "1.15s" } as CSSProperties} d={flame(cx + fw * 0.04, base, fw * 0.36, fh * 0.46)} fill="var(--h5)" />
            <path className="flame" style={{ "--d": "0.9s" } as CSSProperties} d={flame(cx, base + 2, fw * 0.18, fh * 0.24)} fill="var(--h6)" />
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
        <g className="logs" onMouseLeave={() => setHover(null)}>
          {logs.map((l) => (
            <g
              key={l.name}
              className="log"
              data-dim={(hover !== null && hover !== l.name) || undefined}
              onMouseEnter={() => setHover(l.name)}
            >
              <circle cx={l.x} cy={l.y} r={l.r} className="log-bark" />
              <circle cx={l.x} cy={l.y} r={l.r - 3.5} fill={colorOf(colors, l.name)} />
              <circle cx={l.x} cy={l.y} r={(l.r - 3.5) * 0.66} className="log-ring" />
              <circle cx={l.x} cy={l.y} r={(l.r - 3.5) * 0.33} className="log-ring" />
            </g>
          ))}
        </g>
      </svg>
      <figcaption className="hearth-caption" aria-hidden="true">
        {shown ? (
          <>
            <span className="swatch" style={{ background: colorOf(colors, shown.name) }} />
            <strong>{shown.name}</strong> {fmtDuration(shown.seconds)}
          </>
        ) : logs.length ? (
          "One log per category, sized by its time. Hover one."
        ) : (
          "The fire's laid. It catches once you're active."
        )}
      </figcaption>
    </figure>
  );
}
