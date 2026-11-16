import { useState } from "react";
import { fmtDuration } from "../lib";

export type BarRow = { id: string; label: string; detail?: string; seconds: number; color: string };

/** Ranked rows with a trackless bar each. Length is relative to the largest row. */
export function BarList({
  rows,
  limit = 8,
  onFocus,
  empty = "Nothing here yet.",
  label,
}: {
  rows: BarRow[];
  limit?: number;
  onFocus?: (id: string | null) => void;
  empty?: string;
  label: string;
}) {
  const [all, setAll] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  if (!rows.length) return <p className="muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.seconds), 1);
  const shown = all ? rows : rows.slice(0, limit);
  const set = (id: string | null) => {
    setActive(id);
    onFocus?.(id);
  };

  return (
    <>
      <ul className="bars" aria-label={label} data-active={active !== null || undefined} onMouseLeave={() => set(null)}>
        {shown.map((r) => (
          <li
            key={r.id}
            className="bar-row"
            data-on={active === r.id || undefined}
            tabIndex={onFocus ? 0 : undefined}
            onMouseEnter={() => set(r.id)}
            onFocus={() => set(r.id)}
            onBlur={() => set(null)}
          >
            <div className="bar-head">
              <span className="bar-label" title={r.label}>
                {r.label}
                {r.detail && <span className="bar-detail">{r.detail}</span>}
              </span>
              <span className="bar-value">{fmtDuration(r.seconds)}</span>
            </div>
            <div className="bar" style={{ width: `${Math.max(1, (r.seconds / max) * 100)}%`, backgroundColor: r.color }} />
          </li>
        ))}
      </ul>
      {rows.length > limit && (
        <button className="btn btn-quiet btn-small more" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? "Show fewer" : `Show all ${rows.length}`}
        </button>
      )}
    </>
  );
}
