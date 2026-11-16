import type { Colors } from "../api";
import { colorOf, fmtDuration } from "../lib";

export type StackRow = { id: string; label: string; href?: string; total: number; parts: Record<string, number> };

/** One row per period with its time split by category. Lengths are relative to the largest row. */
export function StackList({
  rows,
  order,
  colors,
  focus,
  label,
}: {
  rows: StackRow[];
  order: string[];
  colors: Colors;
  focus: string | null;
  label: string;
}) {
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <ul className="stacks" aria-label={label}>
      {rows.map((r) => {
        const names = order.filter((n) => (r.parts[n] ?? 0) > 0);
        const body = (
          <>
            <span className="stack-label">{r.label}</span>
            <span className="stack-track">
              <span className="stack-bar" style={{ width: `${(r.total / max) * 100}%` }}>
                {names.map((n) => (
                  <span
                    key={n}
                    className="stack-part"
                    style={{ flexGrow: r.parts[n], backgroundColor: colorOf(colors, n) }}
                    data-dim={(focus !== null && focus !== n) || undefined}
                  />
                ))}
              </span>
            </span>
            <span className="stack-value">{r.total > 60 ? fmtDuration(r.total) : "–"}</span>
          </>
        );
        return (
          <li key={r.id}>
            {r.href ? (
              <a className="stack-row" href={r.href} aria-label={`${r.label}, ${fmtDuration(r.total)}`}>
                {body}
              </a>
            ) : (
              <div className="stack-row">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
