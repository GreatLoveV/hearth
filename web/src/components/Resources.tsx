import { useState } from "react";
import { api, type LiveResources, type ResourceRow } from "../api";
import { appName, colorOf, fmtBytes, fmtDuration, useLoad } from "../lib";
import { appHref } from "../router";
import { BarList } from "./BarList";

export const fmtCpu = (v: number) => `${v < 10 ? v.toFixed(1) : Math.round(v)}%`;

type Measure = "mem" | "cpu" | "disk";

const MEASURES: { id: Measure; label: string }[] = [
  { id: "mem", label: "Memory" },
  { id: "cpu", label: "Processor" },
  { id: "disk", label: "Disk" },
];

function rowValue(r: ResourceRow, m: Measure): [number, string] {
  if (m === "mem") return [r.mem_avg, `${fmtBytes(r.mem_avg)} avg, peak ${fmtBytes(r.mem_max)}`];
  if (m === "cpu") return [r.cpu_avg, `${fmtCpu(r.cpu_avg)} avg, peak ${fmtCpu(r.cpu_max)}`];
  return [r.disk, `${fmtBytes(r.disk)} read and written`];
}

/** The machine right now: processor and memory in use. */
export function LiveLine({ live }: { live: LiveResources | null }) {
  if (!live || !live.available) return null;
  return (
    <p className="live-line">
      <span className="live-dot" aria-hidden="true" />
      <span>
        Right now: processor <strong>{fmtCpu(live.cpu)}</strong>, memory{" "}
        <strong>
          {fmtBytes(live.mem_used)} of {fmtBytes(live.mem_total)}
        </strong>
      </span>
    </p>
  );
}

/**
 * Which apps used the most memory, processor or disk in a stretch of time. Covers everything
 * running, not only the app in front, sampled every 10 seconds while Hearth records.
 */
export function ResourcesPanel({
  start,
  end,
  live = false,
  period,
  category,
}: {
  start: number;
  end: number;
  live?: boolean;
  period: string;
  /** Only the apps in this category, with their combined use instead of the whole computer's. */
  category?: string;
}) {
  const [measure, setMeasure] = useState<Measure>("mem");
  const data = useLoad(`res:${start}:${end}`, () => api.resources(start, end), live ? 60_000 : undefined);
  const now = useLoad(`resnow:${live}`, () => (live ? api.resourcesNow() : Promise.resolve(null)), live ? 10_000 : undefined);
  const d = data.data;
  const rows = (d?.apps ?? [])
    .filter((r) => !category || r.category === category)
    .map((r) => ({ r, v: rowValue(r, measure) }))
    .filter(({ v }) => v[0] > 0)
    .sort((a, b) => b.v[0] - a.v[0]);
  const sys = d?.system;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Resources</h2>
        <div className="seg" role="group" aria-label="Measure">
          {MEASURES.map((m) => (
            <button key={m.id} className="day-toggle" aria-pressed={measure === m.id} onClick={() => setMeasure(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!category && <LiveLine live={now.data} />}
      {d && category && rows.length > 0 && (
        <p className="hint res-summary">
          While open over {period}, {category.toLowerCase()} apps together averaged{" "}
          {fmtBytes(rows.reduce((t, { r }) => t + r.mem_avg, 0))} of memory and{" "}
          {fmtCpu(rows.reduce((t, { r }) => t + r.cpu_avg, 0))} processor, and read and wrote{" "}
          {fmtBytes(rows.reduce((t, { r }) => t + r.disk, 0))}.
        </p>
      )}
      {d && sys && !category && (
        <p className="hint res-summary">
          Over {period} the computer averaged {fmtCpu(sys.cpu_avg)} processor (peak {fmtCpu(sys.cpu_max)}) and{" "}
          {fmtBytes(sys.mem_avg)} of memory in use (peak {fmtBytes(sys.mem_max)}), across {fmtDuration(sys.running)} of samples.
        </p>
      )}
      {d ? (
        <BarList
          label={`${category ? `${category} apps` : "Apps"} by ${measure === "mem" ? "memory" : measure === "cpu" ? "processor" : "disk"}`}
          empty={
            category
              ? `No resource samples for ${category.toLowerCase()} apps here yet. Hearth samples them every 10 seconds while it's recording.`
              : "No resource samples here yet. Hearth samples every app's processor, memory and disk use every 10 seconds while it's recording."
          }
          rows={rows.map(({ r, v }) => ({
            id: r.key,
            label: appName(r.key),
            seconds: v[0],
            value: v[1],
            color: colorOf(d.colors, r.category),
            icon: r.key,
            href: appHref(r.key),
          }))}
        />
      ) : (
        <p className="muted">{data.error ?? "Loading resource use"}</p>
      )}
      <p className="hint res-note">
        Everything running counts, not only the app in front. Averages are over the time each app was open.
      </p>
    </section>
  );
}
