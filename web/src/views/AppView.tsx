import { useState } from "react";
import { api, type AppDetail, type LiveResources, type RangeDay } from "../api";
import { AppEditor } from "../components/AppEditor";
import { AppIcon } from "../components/AppIcon";
import { BarList } from "../components/BarList";
import { Embers, hourCells } from "../components/Embers";
import { fmtCpu } from "../components/Resources";
import {
  appKey,
  appName,
  cleanTitle,
  colorOf,
  fmtBytes,
  fmtChange,
  fmtClock,
  fmtDuration,
  fmtShortDate,
  isoDate,
  parseIso,
  today,
  useArrowKeys,
  useLoad,
} from "../lib";
import { categoryHref, href, type Route } from "../router";
import { MonthGrid, period, weekCells, YearGrid, type Kind, type Period } from "./Range";

const KINDS: { id: Kind; label: string }[] = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "year", label: "Year" },
];

const fmtWhen = (t: number) =>
  new Date(t * 1000).toLocaleDateString([], {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** The current period of a kind, as the route value. */
export function currentValue(kind: Kind): string {
  const t = today();
  return kind === "week" ? isoDate(t) : kind === "month" ? isoDate(t).slice(0, 7) : String(t.getFullYear());
}

function LiveUse({ appKeyName, live }: { appKeyName: string; live: LiveResources | null }) {
  if (!live || !live.available) return null;
  const a = live.apps.find((x) => x.key === appKeyName);
  if (!a) return <p className="hint">Not running right now.</p>;
  return (
    <div className="live-use">
      <p className="live-line">
        <span className="live-dot" aria-hidden="true" />
        <span>Running now{a.procs > 1 ? ` as ${a.procs} processes` : ""}</span>
      </p>
      <dl className="kv-tight">
        <div>
          <dt>Processor</dt>
          <dd>{fmtCpu(a.cpu)}</dd>
        </div>
        <div>
          <dt>Memory</dt>
          <dd>
            {fmtBytes(a.mem)} <span className="muted">of {fmtBytes(live.mem_total)}</span>
          </dd>
        </div>
        <div>
          <dt>Disk</dt>
          <dd>{fmtBytes(a.disk / live.every)}/s</dd>
        </div>
      </dl>
    </div>
  );
}

/** Week, month or year, then back, this period and forward. Shared by the app and category pages. */
export function PeriodNav({ kind, p, to }: { kind: Kind; p: Period; to: (k: Kind, v: string) => Route }) {
  return (
    <div className="head-nav">
      <div className="seg" role="group" aria-label="Period">
        {KINDS.map((k) => (
          <a
            key={k.id}
            className="day-toggle seg-link"
            aria-current={k.id === kind ? "page" : undefined}
            href={href(to(k.id, currentValue(k.id)))}
          >
            {k.label}
          </a>
        ))}
      </div>
      <button className="btn btn-quiet btn-icon" onClick={p.prev} aria-label={`Previous ${kind}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m14.5 6-6 6 6 6" />
        </svg>
      </button>
      <button className="btn btn-quiet" onClick={p.current} disabled={p.isCurrent}>
        This {kind}
      </button>
      <button className="btn btn-quiet btn-icon" onClick={p.next} disabled={p.isCurrent} aria-label={`Next ${kind}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m9.5 6 6 6-6 6" />
        </svg>
      </button>
    </div>
  );
}

export default function AppView({ app, kind, value }: { app: string; kind: Kind; value: string }) {
  const to = (k: Kind, v: string): Route => ({
    view: "app",
    app,
    kind: k,
    value: v,
  });
  const p = period(kind, value, to);
  const t = today();
  const firstIso = isoDate(p.first);
  const until = p.last > t ? t : p.last;
  const future = p.first > t;
  const [rev, setRev] = useState(0);
  const [editing, setEditing] = useState(false);
  useArrowKeys(p.prev, p.isCurrent ? () => {} : p.next);

  const load = useLoad(`app:${app}:${kind}:${firstIso}:${rev}`, () =>
    future ? Promise.resolve(null) : api.app(app, firstIso, isoDate(until)),
  );
  const live = useLoad(
    `applive:${app}`,
    () => (p.isCurrent ? api.resourcesNow() : Promise.resolve(null)),
    p.isCurrent ? 10_000 : undefined,
  );
  const data: AppDetail | null =
    load.data && load.data.start === firstIso && appKey(load.data.app) === appKey(app) ? load.data : null;
  const days = new Map<string, RangeDay>(data?.days.map((d) => [d.date, d]));
  const colors = data?.colors ?? {};
  const color = colorOf(colors, data?.category ?? "Other");
  const name = appName(app);
  const change = data ? fmtChange(data.total, data.previous) : null;
  const avg = data && data.active_days ? data.total / data.active_days : 0;
  const busiest = data?.days.reduce<RangeDay | null>((b, d) => (!b || d.total > b.total ? d : b), null);
  const loading = !data && !load.error && !future;
  const r = data?.resources;
  const when = p.isCurrent ? p.eyebrow.toLowerCase() : kind === "month" ? `${p.title} ${p.eyebrow}` : p.title;

  return (
    <>
      <header className="page-head app-head">
        <div className="app-title">
          <AppIcon app={app} size={56} color={color} />
          <div>
            <p className="eyebrow">
              {data ? data.category : "App"}, {when}
            </p>
            <h1>{name}</h1>
          </div>
        </div>
        <div className="app-actions">
          <button className="btn btn-quiet" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />
            </svg>
            Edit
          </button>
          <PeriodNav kind={kind} p={p} to={to} />
        </div>
      </header>

      {editing && <AppEditor key={app} app={app} onClose={() => setEditing(false)} onSaved={() => setRev((x) => x + 1)} />}

      {load.error && !data && (
        <section className="panel notice" role="alert">
          <p>{load.error}</p>
          <button className="btn btn-quiet" onClick={() => setRev((x) => x + 1)}>
            Try again
          </button>
        </section>
      )}

      <section className="panel hero" data-kind={kind} aria-label={`${name} by day`}>
        <div className="hero-total">
          <p className="label">
            {name}, {when}
          </p>
          <p className="figure">{data ? fmtDuration(data.total) : "–"}</p>
          {change && (
            <p className="hero-change">
              {change} than the {kind} before
            </p>
          )}
          {data && data.share > 0 && (
            <p className="hero-change">{Math.round(data.share * 100) || "<1"}% of all your active time</p>
          )}
          {loading && <p className="hint">Reading {name}'s history. The first time can take a few seconds.</p>}
        </div>
        <div className="hero-embers">
          {kind === "week" &&
            (data ? (
              <Embers key={`${app}${firstIso}`} cells={weekCells(p.first, days)} wide label={`Hours in ${name} per day`} />
            ) : (
              <Embers key="ash" cells={weekCells(p.first, new Map())} wide ash />
            ))}
          {kind === "month" && <MonthGrid first={p.first} last={p.last} days={days} />}
          {kind === "year" && <YearGrid first={p.first} last={p.last} days={days} />}
        </div>
        {data && data.total > 0 && (
          <dl className="facts">
            <div>
              <dt>Days used</dt>
              <dd>
                {data.active_days} of {data.days.length}
              </dd>
            </div>
            <div>
              <dt>Average day used</dt>
              <dd>{fmtDuration(avg)}</dd>
            </div>
            <div>
              <dt>Sessions</dt>
              <dd>
                {data.sessions}
                {data.sessions ? `, ${fmtDuration(data.total / data.sessions)} each on average` : ""}
              </dd>
            </div>
            <div>
              <dt>Longest session</dt>
              <dd>
                {data.longest ? (
                  <a
                    href={href({
                      view: "day",
                      date: isoDate(new Date(data.longest.start * 1000)),
                    })}
                  >
                    {fmtDuration(data.longest.seconds)}, {fmtShortDate(new Date(data.longest.start * 1000))} at{" "}
                    {fmtClock(data.longest.start)}
                  </a>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>Busiest day</dt>
              <dd>
                {busiest && busiest.total > 0 ? (
                  <a href={href({ view: "day", date: busiest.date })}>
                    {fmtShortDate(parseIso(busiest.date)!)}, {fmtDuration(busiest.total)}
                  </a>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>First recorded</dt>
              <dd>{data.first_seen ? fmtWhen(data.first_seen) : "–"}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>
                <span className="swatch inline" style={{ background: color }} aria-hidden="true" />{" "}
                <a href={categoryHref(data.category, kind, value)}>{data.category}</a>
              </dd>
            </div>
            <div>
              <dt>Search its history</dt>
              <dd>
                <a href={href({ view: "search", q: appKey(app) })}>Every title in {name}</a>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {future && (
        <section className="panel notice">
          <p>This {kind} hasn't started yet.</p>
        </section>
      )}

      {data && data.total === 0 && (
        <section className="panel notice">
          <p>
            {name} wasn't used in this {kind}.
          </p>
        </section>
      )}

      {data && (data.total > 0 || r) && (
        <>
          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>When you use it</h2>
                <p className="muted">average minutes per hour</p>
              </div>
              {data.active_days > 0 ? (
                <>
                  <Embers
                    key={`r${app}${firstIso}`}
                    cells={hourCells(data.rhythm)}
                    still
                    label={`Average minutes in ${name} per hour`}
                  />
                  <p className="hint rhythm-note">
                    Averaged over the {data.active_days} {data.active_days === 1 ? "day" : "days"} you used it.
                  </p>
                </>
              ) : (
                <p className="muted">No time in front this {kind}.</p>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Resources</h2>
                <p className="muted">while it was open</p>
              </div>
              {p.isCurrent && <LiveUse appKeyName={appKey(app)} live={live.data} />}
              {r ? (
                <>
                  {p.isCurrent && <p className="res-label">Over {when}</p>}
                  <dl className="kv-tight">
                    <div>
                      <dt>Processor</dt>
                      <dd>
                        {fmtCpu(r.cpu_avg)} average, peak {fmtCpu(r.cpu_max)}
                      </dd>
                    </div>
                    <div>
                      <dt>Memory</dt>
                      <dd>
                        {fmtBytes(r.mem_avg)} average, peak {fmtBytes(r.mem_max)}
                      </dd>
                    </div>
                    <div>
                      <dt>Disk</dt>
                      <dd>{fmtBytes(r.disk)} read and written</dd>
                    </div>
                    <div>
                      <dt>Open for</dt>
                      <dd>about {fmtDuration(r.running)}, in front or not</dd>
                    </div>
                  </dl>
                </>
              ) : (
                <p className="muted">
                  No samples for this {kind}. Processor, memory and disk use are measured every 10 seconds while Hearth records,
                  from the day this feature was added.
                </p>
              )}
              {data.exe && (
                <p className="hint exe-path">
                  <code>{data.exe}</code>
                </p>
              )}
            </section>
          </div>

          {data.total > 0 && (
            <div className="grid-2">
              <section className="panel">
                <div className="panel-head">
                  <h2>Windows</h2>
                  <p className="muted">{data.titles.length >= 25 ? "top 25" : `${data.titles.length} titles`}</p>
                </div>
                <BarList
                  label={`Time per window title in ${name}`}
                  empty="No window titles recorded."
                  rows={data.titles.map((w) => ({
                    id: w.title,
                    label: cleanTitle(w.title),
                    seconds: w.seconds,
                    color,
                  }))}
                />
              </section>
              {data.sites.length > 0 ? (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Sites</h2>
                  </div>
                  <BarList
                    label={`Time per website in ${name}`}
                    rows={data.sites.map((w) => ({
                      id: w.domain,
                      label: w.domain,
                      seconds: w.seconds,
                      color,
                    }))}
                  />
                </section>
              ) : (
                <section className="panel">
                  <div className="panel-head">
                    <h2>Categories</h2>
                  </div>
                  <BarList
                    label={`Time in ${name} per category`}
                    rows={data.categories.map((c) => ({
                      id: c.name,
                      label: c.name,
                      seconds: c.seconds,
                      color: colorOf(colors, c.name),
                    }))}
                  />
                  {data.categories.length === 1 && (
                    <p className="hint rhythm-note">
                      All of it counts as {data.categories[0].name}. Change that in Settings, Categories.
                    </p>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
