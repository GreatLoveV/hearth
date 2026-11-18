import { useState, type CSSProperties } from "react";
import { api, type RangeData, type RangeDay } from "../api";
import { BarList } from "../components/BarList";
import { Embers, hourCells, type EmberCell } from "../components/Embers";
import { PeriodHead } from "../components/PeriodHead";
import { StackList } from "../components/StackList";
import { ResourcesPanel } from "../components/Resources";
import {
  addDays,
  appName,
  colorOf,
  fmtChange,
  fmtDuration,
  fmtShortDate,
  heatDay,
  heatVar,
  isoDate,
  parseIso,
  startOfWeek,
  today,
  useLoad,
  WEEKDAYS,
} from "../lib";
import { appHref, go, href, type Route } from "../router";

export type Kind = "week" | "month" | "year";

type Period = {
  first: Date;
  last: Date;
  eyebrow: string;
  title: string;
  isCurrent: boolean;
  prev: () => void;
  next: () => void;
  current: () => void;
};

const monthName = (d: Date, style: "long" | "short" = "long") => d.toLocaleDateString([], { month: style });

const rangeRoute = (kind: Kind, value: string): Route =>
  kind === "week" ? { view: "week", date: value } : kind === "month" ? { view: "month", month: value } : { view: "year", year: value };

/** A week, month or year, and how to step from it. `to` builds the route for another period of the same kind. */
export function period(kind: Kind, value: string, to: (kind: Kind, value: string) => Route = rangeRoute): Period {
  const t = today();
  if (kind === "week") {
    const first = startOfWeek(parseIso(value) ?? t);
    const last = addDays(first, 6);
    const isCurrent = first.getTime() === startOfWeek(t).getTime();
    return {
      first,
      last,
      isCurrent,
      eyebrow: isCurrent ? "This week" : `Week of ${first.getFullYear()}`,
      title: `${fmtShortDate(first)} to ${fmtShortDate(last)}`,
      prev: () => go(to("week", isoDate(addDays(first, -7)))),
      next: () => go(to("week", isoDate(addDays(first, 7)))),
      current: () => go(to("week", isoDate(t))),
    };
  }
  if (kind === "month") {
    const p = parseIso(value) ?? t;
    const first = new Date(p.getFullYear(), p.getMonth(), 1);
    const last = new Date(p.getFullYear(), p.getMonth() + 1, 0);
    const isCurrent = first.getFullYear() === t.getFullYear() && first.getMonth() === t.getMonth();
    const shift = (n: number) => isoDate(new Date(first.getFullYear(), first.getMonth() + n, 1)).slice(0, 7);
    return {
      first,
      last,
      isCurrent,
      eyebrow: isCurrent ? "This month" : String(first.getFullYear()),
      title: monthName(first),
      prev: () => go(to("month", shift(-1))),
      next: () => go(to("month", shift(1))),
      current: () => go(to("month", isoDate(t).slice(0, 7))),
    };
  }
  const y = /^\d{4}$/.test(value) ? Number(value) : t.getFullYear();
  const isCurrent = y === t.getFullYear();
  return {
    first: new Date(y, 0, 1),
    last: new Date(y, 11, 31),
    isCurrent,
    eyebrow: isCurrent ? "This year" : "Year",
    title: String(y),
    prev: () => go(to("year", String(y - 1))),
    next: () => go(to("year", String(y + 1))),
    current: () => go(to("year", String(t.getFullYear()))),
  };
}

const dayHref = (date: string) => href({ view: "day", date });
const longDay = (d: Date) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

// Heat grids ------------------------------------------------------------------------

function DayCell({
  date,
  day,
  future,
  onHover,
  label,
}: {
  date: Date;
  day: RangeDay | undefined;
  future: boolean;
  onHover: (d: Date | null) => void;
  label?: string;
}) {
  if (future || !day)
    return (
      <span className="cell" data-future aria-hidden="true">
        {label}
      </span>
    );
  const k = heatDay(day.total);
  return (
    <a
      className="cell"
      href={dayHref(day.date)}
      style={{ "--c": heatVar(k) } as CSSProperties}
      data-dark={k >= 3 || undefined}
      aria-label={`${longDay(date)}, ${day.total > 60 ? fmtDuration(day.total) : "nothing recorded"}`}
      onMouseEnter={() => onHover(date)}
      onFocus={() => onHover(date)}
      onBlur={() => onHover(null)}
    >
      {label}
    </a>
  );
}

function Readout({ hover, days, fallback }: { hover: Date | null; days: Map<string, RangeDay>; fallback: string }) {
  const d = hover ? days.get(isoDate(hover)) : undefined;
  return (
    <p className="readout" aria-live="polite">
      {hover && d ? (
        <>
          <strong>{longDay(hover)}</strong> {d.total > 60 ? fmtDuration(d.total) : "nothing recorded"}
        </>
      ) : (
        <span className="muted">{fallback}</span>
      )}
    </p>
  );
}

export function MonthGrid({ first, last, days }: { first: Date; last: Date; days: Map<string, RangeDay> }) {
  const [hover, setHover] = useState<Date | null>(null);
  const lead = (first.getDay() + 6) % 7;
  const t = today();
  const dates: Date[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);
  return (
    <div className="month-wrap">
      <div className="month-grid" data-active={hover !== null || undefined} onMouseLeave={() => setHover(null)}>
        {WEEKDAYS.map((w) => (
          <span key={w} className="grid-head" aria-hidden="true">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead${i}`} aria-hidden="true" />
        ))}
        {dates.map((d) => (
          <DayCell
            key={d.getDate()}
            date={d}
            day={days.get(isoDate(d))}
            future={d > t}
            onHover={setHover}
            label={String(d.getDate())}
          />
        ))}
      </div>
      <Readout hover={hover} days={days} fallback="Each day is coloured by hours active. Open one to see it hour by hour." />
    </div>
  );
}

export function YearGrid({ first, last, days }: { first: Date; last: Date; days: Map<string, RangeDay> }) {
  const [hover, setHover] = useState<Date | null>(null);
  const t = today();
  const start = startOfWeek(first);
  const weeks: Date[] = [];
  for (let w = start; w <= last; w = addDays(w, 7)) weeks.push(w);
  return (
    <div className="year-wrap">
      <div className="year-scroll">
        <div
          className="year-grid"
          style={{ "--weeks": weeks.length } as CSSProperties}
          data-active={hover !== null || undefined}
          onMouseLeave={() => setHover(null)}
        >
          <span className="year-corner" aria-hidden="true" />
          {weeks.map((w, i) => {
            const inMonth = addDays(w, 6);
            const startsMonth = inMonth.getDate() <= 7 && inMonth >= first && inMonth <= last;
            return (
              <span key={`m${i}`} className="year-month" aria-hidden="true">
                {startsMonth || i === 0 ? monthName(i === 0 ? first : inMonth, "short") : ""}
              </span>
            );
          })}
          {WEEKDAYS.map((name, row) => (
            <div key={name} className="year-row">
              <span className="year-day" aria-hidden="true">
                {row % 2 === 0 ? name : ""}
              </span>
              {weeks.map((w) => {
                const d = addDays(w, row);
                if (d < first || d > last) return <span key={w.getTime()} className="cell cell-out" aria-hidden="true" />;
                return <DayCell key={w.getTime()} date={d} day={days.get(isoDate(d))} future={d > t} onHover={setHover} />;
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="year-foot">
        <Readout hover={hover} days={days} fallback="Each square is a day, coloured by hours active." />
        <div className="legend" aria-label="Heat scale">
          <span>Less</span>
          {[0, 1, 2, 3, 4, 5, 6].map((k) => (
            <span key={k} className="legend-cell" style={{ background: heatVar(k) }} />
          ))}
          <span>8h or more</span>
        </div>
      </div>
    </div>
  );
}

export function weekCells(first: Date, days: Map<string, RangeDay>): EmberCell[] {
  const t = today();
  return WEEKDAYS.map((w, i) => {
    const d = addDays(first, i);
    const day = days.get(isoDate(d));
    const sec = day?.total ?? 0;
    return {
      k: heatDay(sec),
      label: `${w} ${d.getDate()}`,
      value: sec > 60 ? fmtDuration(sec) : "",
      aria: `${longDay(d)}, ${sec > 60 ? fmtDuration(sec) : d > t ? "still to come" : "nothing recorded"}`,
      href: d > t ? undefined : dayHref(isoDate(d)),
    };
  });
}

// Page --------------------------------------------------------------------------------

export default function Range({ kind, value }: { kind: Kind; value: string }) {
  const p = period(kind, value);
  const t = today();
  const firstIso = isoDate(p.first);
  const until = p.last > t ? t : p.last;
  const future = p.first > t;
  const [focus, setFocus] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  const load = useLoad(`${kind}:${firstIso}:${rev}`, () =>
    future ? Promise.resolve(null) : api.range(firstIso, isoDate(until)),
  );
  const data: RangeData | null = load.fresh || load.data?.start === firstIso ? load.data : null;
  const loading = !data && !load.error && !future;
  const days = new Map(data?.days.map((d) => [d.date, d]));
  const colors = data?.colors ?? {};

  const busiest = data?.days.reduce<RangeDay | null>((b, d) => (!b || d.total > b.total ? d : b), null);
  const change = data ? fmtChange(data.total, data.previous.total) : null;
  const unitBefore = `the ${kind} before`;
  const avg = data && data.active_days ? data.total / data.active_days : 0;

  const months =
    kind === "year" && data
      ? Array.from({ length: 12 }, (_, m) => {
          const prefix = `${p.first.getFullYear()}-${String(m + 1).padStart(2, "0")}`;
          const sec = data.days.filter((d) => d.date.startsWith(prefix)).reduce((s, d) => s + d.total, 0);
          const daysIn = new Date(p.first.getFullYear(), m + 1, 0).getDate();
          return { m, prefix, sec, daysIn };
        })
      : [];

  const catOrder = data?.categories.map((c) => c.name) ?? [];

  const categories = (
    <section className="panel">
      <div className="panel-head">
        <h2>Categories</h2>
        <p className="muted">vs {unitBefore}</p>
      </div>
      {data && (
        <BarList
          label="Time per category"
          rows={data.categories.map((c) => ({
            id: c.name,
            label: c.name,
            detail: fmtChange(c.seconds, data.previous.categories[c.name] ?? 0) ?? undefined,
            seconds: c.seconds,
            color: colorOf(colors, c.name),
          }))}
          onFocus={setFocus}
        />
      )}
    </section>
  );

  const rhythm = (
    <section className="panel">
      <div className="panel-head">
        <h2>An average day</h2>
        <p className="muted">minutes per hour</p>
      </div>
      {data && data.active_days > 0 ? (
        <>
          <Embers key={`r${firstIso}`} cells={hourCells(data.rhythm)} still label="Average minutes active per hour" />
          <p className="hint rhythm-note">
            Averaged over the {data.active_days} {data.active_days === 1 ? "day" : "days"} with any activity.
          </p>
        </>
      ) : (
        <p className="muted">No active days yet.</p>
      )}
    </section>
  );

  const weekdays = (
    <section className="panel">
      <div className="panel-head">
        <h2>By weekday</h2>
        <p className="muted">average active day</p>
      </div>
      {data && (
        <BarList
          label="Average time per weekday"
          limit={7}
          empty="No active days yet."
          rows={
            data.active_days
              ? WEEKDAYS.map((w, i) => ({
                  id: w,
                  label: w,
                  seconds: data.weekdays[i],
                  color: heatVar(Math.max(1, heatDay(data.weekdays[i]))),
                }))
              : []
          }
        />
      )}
    </section>
  );

  return (
    <>
      <PeriodHead
        eyebrow={p.eyebrow}
        title={p.title}
        unit={kind}
        onPrev={p.prev}
        onNext={p.next}
        onCurrent={p.current}
        isCurrent={p.isCurrent}
      />

      {load.error && !data && (
        <section className="panel notice" role="alert">
          <p>{load.error}</p>
          <button className="btn btn-quiet" onClick={() => setRev((r) => r + 1)}>
            Try again
          </button>
        </section>
      )}

      <section className="panel hero" data-kind={kind} aria-label={`The ${kind} by day`}>
        <div className="hero-total">
          <p className="label">Active{p.isCurrent ? " so far" : ""}</p>
          <p className="figure">{data ? fmtDuration(data.total) : "–"}</p>
          {change && (
            <p className="hero-change">
              {change} than {unitBefore}
            </p>
          )}
          {loading && kind === "year" && <p className="hint">Reading the whole year. The first time takes a few seconds.</p>}
        </div>
        <div className="hero-embers">
          {kind === "week" &&
            (data ? (
              <Embers key={firstIso} cells={weekCells(p.first, days)} wide label="Hours active per day" />
            ) : (
              <Embers key="ash" cells={weekCells(p.first, new Map())} wide ash />
            ))}
          {kind === "month" && <MonthGrid first={p.first} last={p.last} days={days} />}
          {kind === "year" && <YearGrid first={p.first} last={p.last} days={days} />}
        </div>
        {data && data.total > 0 && (
          <dl className="facts">
            <div>
              <dt>Active days</dt>
              <dd>
                {data.active_days} of {data.days.length}
              </dd>
            </div>
            <div>
              <dt>Average active day</dt>
              <dd>{fmtDuration(avg)}</dd>
            </div>
            <div>
              <dt>Busiest day</dt>
              <dd>
                {busiest && (
                  <a href={dayHref(busiest.date)}>
                    {fmtShortDate(parseIso(busiest.date)!)}, {fmtDuration(busiest.total)}
                  </a>
                )}
              </dd>
            </div>
            <div>
              <dt>Top app</dt>
              <dd>
                {data.apps[0] ? (
                  <a href={appHref(data.apps[0].app)}>
                    {appName(data.apps[0].app)}, {fmtDuration(data.apps[0].seconds)}
                  </a>
                ) : (
                  "–"
                )}
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
          <p>Nothing was recorded in this {kind}.</p>
        </section>
      )}

      {data && data.total > 0 && (
        <>
          {kind === "week" && (
            <>
              <section className="panel">
                <div className="panel-head">
                  <h2>Days</h2>
                  <p className="muted">split by category</p>
                </div>
                <StackList
                  label="Time per day by category"
                  rows={WEEKDAYS.map((w, i) => {
                    const date = addDays(p.first, i);
                    const d = days.get(isoDate(date));
                    return {
                      id: isoDate(date),
                      label: `${w} ${date.getDate()}`,
                      href: date > t ? undefined : dayHref(isoDate(date)),
                      total: d?.total ?? 0,
                      parts: d?.categories ?? {},
                    };
                  })}
                  order={catOrder}
                  colors={colors}
                  focus={focus}
                />
              </section>
              <div className="grid-2">
                {categories}
                {rhythm}
              </div>
            </>
          )}

          {kind === "month" && (
            <>
              <div className="grid-2">
                {categories}
                {weekdays}
              </div>
              {rhythm}
            </>
          )}

          {kind === "year" && (
            <>
              <div className="grid-2">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Months</h2>
                    <p className="muted">split by category</p>
                  </div>
                  <StackList
                    label="Time per month by category"
                    rows={months.map(({ m, prefix }) => {
                      const parts: Record<string, number> = {};
                      let total = 0;
                      for (const d of data.days) {
                        if (!d.date.startsWith(prefix)) continue;
                        total += d.total;
                        for (const [n, s] of Object.entries(d.categories)) parts[n] = (parts[n] ?? 0) + s;
                      }
                      const first = new Date(p.first.getFullYear(), m, 1);
                      return {
                        id: prefix,
                        label: monthName(first, "short"),
                        href: first > t ? undefined : href({ view: "month", month: prefix }),
                        total,
                        parts,
                      };
                    })}
                    order={catOrder}
                    colors={colors}
                    focus={focus}
                  />
                </section>
                {categories}
              </div>
              <div className="grid-2">
                {weekdays}
                {rhythm}
              </div>
            </>
          )}

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Apps</h2>
                <p className="muted">top {data.apps.length}</p>
              </div>
              <BarList
                label="Time per app"
                rows={data.apps.map((a) => ({
                  id: a.app,
                  label: appName(a.app),
                  detail: a.category,
                  seconds: a.seconds,
                  color: colorOf(colors, a.category),
                  icon: a.app,
                  href: appHref(a.app, kind, kind === "week" ? firstIso : kind === "month" ? firstIso.slice(0, 7) : firstIso.slice(0, 4)),
                }))}
              />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Sites</h2>
              </div>
              <BarList
                label="Time per website"
                empty="No browser tabs recorded. Install the Firefox extension from Settings to see sites."
                rows={data.sites.map((w) => ({
                  id: w.domain,
                  label: w.domain,
                  seconds: w.seconds,
                  color: colorOf(colors, w.category),
                }))}
              />
            </section>
          </div>
          <ResourcesPanel
            start={p.first.getTime() / 1000}
            end={addDays(p.last, 1).getTime() / 1000}
            live={p.isCurrent}
            period={p.isCurrent ? p.eyebrow.toLowerCase() : `this ${kind}`}
          />
        </>
      )}
    </>
  );
}
