import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Block, Colors } from "../api";
import { appName, cleanTitle, colorOf, fmtClock, fmtDuration } from "../lib";
import { appHref, categoryHref } from "../router";
import { AppIcon } from "./AppIcon";

export type Focus = { kind: "app" | "category"; value: string } | null;

const MIN_VIEW = 15 * 60; // zoomed all the way in, the timeline shows 15 minutes
const TICK_STEPS = [300, 600, 900, 1800, 3600, 7200, 10800];
const DRAG = 4; // pixels before a press becomes a drag

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pad = (n: number) => String(n).padStart(2, "0");
const tickLabel = (t: number) => {
  const d = new Date(t * 1000);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Time marks for the visible stretch: the finest step that still leaves room, counted from midnight. */
function ticksFor(start: number, end: number, vs: number, ve: number): number[] {
  const step = TICK_STEPS.find((s) => (ve - vs) / s <= 8) ?? 10800;
  const out: number[] = [];
  for (let t = start + Math.ceil((vs - start) / step) * step; t <= ve + 1 && t <= end; t += step) out.push(t);
  return out;
}

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
  // The visible stretch of the day. Zooming narrows it; dragging or scrolling sideways moves it.
  const [view, setView] = useState<[number, number]>([start, end]);
  useEffect(() => setView([start, end]), [start, end]);
  const [vs, ve] = view;
  const vspan = ve - vs;
  const zoomed = vspan < span - 1;
  const pct = (t: number) => ((clamp(t, vs, ve) - vs) / vspan) * 100;
  const dayPct = (t: number) => ((clamp(t, start, end) - start) / span) * 100;
  const lane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; from: [number, number]; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const minView = Math.min(MIN_VIEW, span);

  const fit = useCallback(
    (from: number, len: number): [number, number] => {
      const l = clamp(len, minView, span);
      const a = clamp(from, start, end - l);
      return [a, a + l];
    },
    [start, end, span, minView],
  );
  /** Zoom by a factor (above 1 zooms in), keeping the moment under `anchor` where it is. */
  const zoomBy = useCallback(
    (factor: number, anchor?: number) =>
      setView(([a, b]) => {
        const len = b - a;
        const at = anchor ?? (a + b) / 2;
        const next = clamp(len / factor, minView, span);
        return fit(at - ((at - a) / len) * next, next);
      }),
    [fit, span, minView],
  );
  const centreOn = (t: number) => setView(([a, b]) => fit(t - (b - a) / 2, b - a));

  // The wheel zooms around the pointer; sideways or Shift+wheel moves along. Needs a non-passive listener.
  useEffect(() => {
    const el = lane.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      e.preventDefault();
      setView(([a, b]) => {
        const len = b - a;
        const sideways = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
        if (sideways) return fit(a + ((e.shiftKey ? e.deltaY : e.deltaX) / rect.width) * len, len);
        const at = a + ((e.clientX - rect.left) / rect.width) * len;
        const next = clamp(len * Math.exp(e.deltaY * 0.0015), minView, span);
        return fit(at - ((at - a) / len) * next, next);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [fit, span, minView]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, from: view, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !lane.current) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < DRAG || !zoomed) return;
      d.moved = true;
      lane.current.setPointerCapture(e.pointerId);
    }
    const len = d.from[1] - d.from[0];
    setView(fit(d.from[0] - (dx / lane.current.clientWidth) * len, len));
  };
  const onPointerUp = () => {
    dragged.current = !!drag.current?.moved;
    drag.current = null;
  };

  // Slider position: 0 is the whole day, 100 is fully zoomed in, on a log scale so each step feels even.
  const maxZoom = Math.log(span / minView) || 1;
  const sliderValue = Math.round((Math.log(span / vspan) / maxZoom) * 100);
  const setSlider = (v: number) => {
    const len = span / Math.exp((v / 100) * maxZoom);
    setView(([a, b]) => fit((a + b) / 2 - len / 2, len));
  };
  const activity = blocks.length ? fit(blocks[0].start - 300, blocks[blocks.length - 1].end - blocks[0].start + 600) : null;
  const ticks = ticksFor(start, end, vs, ve);
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
      const i = Math.max(0, Math.min(blocks.length - 1, from + step));
      choose(i);
      const b = blocks[i];
      if (b.end < vs || b.start > ve) centreOn((b.start + b.end) / 2);
    } else if (e.key === "Escape") choose(null);
    else if (e.key === "+" || e.key === "=") zoomBy(1.5);
    else if (e.key === "-" || e.key === "_") zoomBy(1 / 1.5);
    else if (e.key === "0") setView([start, end]);
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
      <div className="zoom-bar">
        <button
          className="btn btn-quiet btn-icon btn-small"
          onClick={() => zoomBy(1 / 1.5)}
          disabled={!zoomed}
          aria-label="Zoom out"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 12h12" />
          </svg>
        </button>
        <input
          type="range"
          className="zoom-slider"
          min={0}
          max={100}
          value={sliderValue}
          onChange={(e) => setSlider(Number(e.target.value))}
          aria-label="Timeline zoom"
          aria-valuetext={`Showing ${tickLabel(vs)} to ${tickLabel(ve)}`}
        />
        <button
          className="btn btn-quiet btn-icon btn-small"
          onClick={() => zoomBy(1.5)}
          disabled={vspan <= minView + 1}
          aria-label="Zoom in"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 12h12M12 6v12" />
          </svg>
        </button>
        <span className="zoom-range">{zoomed ? `${tickLabel(vs)} to ${ve >= end ? "24:00" : tickLabel(ve)}` : "Whole day"}</span>
        {activity && (activity[0] !== vs || activity[1] !== ve) && (
          <button className="btn btn-quiet btn-small" onClick={() => setView(activity)}>
            Fit activity
          </button>
        )}
        {zoomed && (
          <button className="btn btn-quiet btn-small" onClick={() => setView([start, end])}>
            Whole day
          </button>
        )}
      </div>
      <div
        ref={lane}
        className="lane"
        tabIndex={0}
        data-arrows
        data-zoomed={zoomed || undefined}
        role="group"
        aria-label="Timeline of the day. Left and right arrows step through blocks, plus and minus zoom, 0 shows the whole day, Escape clears."
        onKeyDown={onKey}
        onMouseLeave={() => setHover(null)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {ticks.map((t) => (
          <span key={t} className="grid-line" style={{ left: `${pct(t)}%` }} aria-hidden="true" />
        ))}
        {blocks.map((b, i) =>
          (b.end < vs || b.start > ve) && i !== shownIndex ? null : (
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
              onMouseEnter={() => !drag.current?.moved && setHover(i)}
              onClick={() => {
                if (dragged.current) return; // the press was a drag along the timeline
                choose(pin === i ? null : i);
              }}
            />
          ),
        )}
        {now !== null && now > vs && now < ve && (
          <span className="now-mark" style={{ left: `${pct(now)}%` }} aria-hidden="true" />
        )}
      </div>
      <div className="ticks" aria-hidden="true">
        {ticks.map((t) => {
          const at = pct(t);
          return (
            <span key={t} style={{ left: `${at}%` }} data-edge={at < 3 ? "start" : at > 97 ? "end" : undefined}>
              {t >= end ? "24:00" : tickLabel(t)}
            </span>
          );
        })}
      </div>
      {zoomed && (
        <div
          className="overview"
          aria-hidden="true"
          title="Where in the day the timeline is showing. Click or drag to move."
          onPointerDown={(e) => {
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            const r = el.getBoundingClientRect();
            centreOn(start + ((e.clientX - r.left) / r.width) * span);
          }}
          onPointerMove={(e) => {
            const el = e.currentTarget;
            if (!el.hasPointerCapture(e.pointerId)) return;
            const r = el.getBoundingClientRect();
            centreOn(start + ((e.clientX - r.left) / r.width) * span);
          }}
        >
          {blocks.map((b, i) => (
            <span
              key={`${b.start}-${i}`}
              className="overview-block"
              style={{
                left: `${dayPct(b.start)}%`,
                width: `${Math.max(0.15, dayPct(b.end) - dayPct(b.start))}%`,
                background: colorOf(colors, b.category),
              }}
            />
          ))}
          <span className="overview-window" style={{ left: `${dayPct(vs)}%`, width: `${dayPct(ve) - dayPct(vs)}%` }} />
        </div>
      )}

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
            {blocks.length
              ? "Hover a block to see what it was. Click it to pin it. Scroll on the timeline to zoom, and drag to move along it."
              : "No activity on the timeline."}
          </p>
        )}
      </div>
    </div>
  );
}
