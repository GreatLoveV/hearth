import { useState, type KeyboardEvent } from "react";
import type { Block, Colors } from "../api";
import { appName, cleanTitle, colorOf, fmtClock, fmtDuration } from "../lib";
import { appHref, categoryHref } from "../router";
import { AppIcon } from "./AppIcon";

export type Focus = { kind: "app" | "category"; value: string } | null;

const TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24];

export function Timeline({
  blocks,
  start,
  end,
  colors,
  focus,
  now,
  onForget,
}: {
  blocks: Block[];
  start: number;
  end: number;
  colors: Colors;
  focus: Focus;
  now: number | null;
  onForget: (b: Block) => Promise<void>;
}) {
  const [pin, setPin] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const span = end - start;
  const pct = (t: number) => ((Math.min(end, Math.max(start, t)) - start) / span) * 100;
  const shownIndex = pin ?? hover;
  const shown = shownIndex !== null ? blocks[shownIndex] : undefined;
  const matches = (b: Block) => !focus || (focus.kind === "app" ? b.app === focus.value : b.category === focus.value);

  const choose = (i: number | null) => {
    setPin(i);
    setConfirm(false);
    setError(null);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!blocks.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      const from = pin ?? (step > 0 ? -1 : blocks.length);
      choose(Math.max(0, Math.min(blocks.length - 1, from + step)));
    } else if (e.key === "Escape") choose(null);
  };

  const forget = async () => {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      await onForget(shown);
      choose(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="timeline">
      <div
        className="lane"
        tabIndex={0}
        data-arrows
        role="group"
        aria-label="Timeline of the day. Left and right arrows step through blocks, Escape clears."
        onKeyDown={onKey}
        onMouseLeave={() => setHover(null)}
      >
        {blocks.map((b, i) => (
          <button
            key={`${b.start}-${i}`}
            className="block"
            tabIndex={-1}
            style={{
              left: `${pct(b.start)}%`,
              width: `max(2px, ${pct(b.end) - pct(b.start)}%)`,
              background: colorOf(colors, b.category),
            }}
            data-dim={!matches(b) || undefined}
            data-on={i === shownIndex || undefined}
            aria-label={`${fmtClock(b.start)} to ${fmtClock(b.end)}, ${appName(b.app)}`}
            onMouseEnter={() => setHover(i)}
            onClick={() => choose(pin === i ? null : i)}
          />
        ))}
        {now !== null && now > start && now < end && (
          <span className="now-mark" style={{ left: `${pct(now)}%` }} aria-hidden="true" />
        )}
      </div>
      <div className="ticks" aria-hidden="true">
        {TICKS.map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }} data-edge={h === 0 ? "start" : h === 24 ? "end" : undefined}>
            {String(h % 24).padStart(2, "0")}:00
          </span>
        ))}
      </div>

      <div className="block-detail" aria-live="polite">
        {shown ? (
          <>
            <div className="detail-main">
              <AppIcon app={shown.app} size={32} color={colorOf(colors, shown.category)} />
              <div className="detail-text">
                <p className="detail-title">
                  <a href={appHref(shown.app)}>{appName(shown.app)}</a>{" "}
                  <a className="muted" href={categoryHref(shown.category)}>
                    {shown.category}
                  </a>
                </p>
                <p className="detail-sub">{cleanTitle(shown.title) || shown.domain || "No window title"}</p>
              </div>
              <p className="detail-time">
                {fmtClock(shown.start)} to {fmtClock(shown.end)}
                <span>{fmtDuration(shown.end - shown.start)}</span>
              </p>
            </div>
            {pin !== null &&
              (confirm ? (
                <div className="confirm" role="alert">
                  <p>
                    Delete {fmtClock(shown.start)} to {fmtClock(shown.end)} from your history? Everything recorded in that time
                    goes, and it can't be brought back.
                  </p>
                  <div className="confirm-actions">
                    <button className="btn btn-danger" onClick={forget} disabled={busy}>
                      {busy ? "Deleting" : "Delete it"}
                    </button>
                    <button className="btn btn-quiet" onClick={() => setConfirm(false)} disabled={busy}>
                      Keep it
                    </button>
                  </div>
                  {error && <p className="error-text">{error}</p>}
                </div>
              ) : (
                <div className="detail-actions">
                  <button className="btn btn-quiet btn-small" onClick={() => setConfirm(true)}>
                    Forget this block
                  </button>
                  <button className="btn btn-quiet btn-small" onClick={() => choose(null)}>
                    Unpin
                  </button>
                </div>
              ))}
          </>
        ) : (
          <p className="hint">
            {blocks.length ? "Hover a block to see what it was. Click it to pin it." : "No activity on the timeline."}
          </p>
        )}
      </div>
    </div>
  );
}
