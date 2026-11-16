import { useState, type CSSProperties } from "react";
import { fmtDuration, heatHour, heatVar } from "../lib";

export type EmberCell = { k: number; label: string; value: string; aria: string; href?: string };

const pad = (h: number) => String(h).padStart(2, "0");

/** Cells for the 24 hours of a day (or an average day). */
export function hourCells(hours: number[]): EmberCell[] {
  return hours.map((sec, i) => ({
    k: heatHour(sec),
    label: String(i),
    value: `${Math.round(sec / 60)}m`,
    aria: `${pad(i)}:00 to ${pad((i + 1) % 24)}:00, ${sec > 30 ? fmtDuration(sec) : "nothing"} active`,
  }));
}

/**
 * A row of embers on the heat scale. Mount with a new `key` per period so the catch plays once.
 * `still` skips the catch (secondary rows); `ash` draws the unlit placeholder while loading.
 */
export function Embers({
  cells,
  ash = false,
  still = false,
  hot,
  wide = false,
  label,
}: {
  cells: EmberCell[];
  ash?: boolean;
  still?: boolean;
  hot?: number;
  wide?: boolean;
  label?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  return (
    <div
      className="embers"
      role="list"
      aria-label={label}
      style={{ "--n": cells.length } as CSSProperties}
      data-active={active !== null || undefined}
      data-ash={ash || undefined}
      data-still={still || undefined}
      data-wide={wide || undefined}
      onMouseLeave={() => setActive(null)}
    >
      {cells.map((c, i) => {
        const k = ash ? 0 : c.k;
        const style = { "--c": heatVar(k), "--up": k === 0 ? "var(--line)" : heatVar(k + 1), "--i": i } as CSSProperties;
        const common = {
          className: "ember",
          style,
          "aria-label": c.aria,
          "data-on": active === i || undefined,
          "data-hot": (!ash && i === hot) || undefined,
          "data-dark": k >= 3 || undefined,
          onMouseEnter: () => setActive(i),
          onFocus: () => setActive(i),
          onBlur: () => setActive(null),
        };
        const inner = (
          <>
            <span className="ember-cell">
              <span className="ember-min" aria-hidden="true">
                {ash ? "" : c.value}
              </span>
            </span>
            <span className="ember-hour" aria-hidden="true">
              {c.label}
            </span>
          </>
        );
        return (
          <div role="listitem" key={i} className="ember-slot">
            {c.href && !ash ? (
              <a {...common} href={c.href}>
                {inner}
              </a>
            ) : (
              <div {...common} role="img" tabIndex={ash ? -1 : 0}>
                {inner}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
