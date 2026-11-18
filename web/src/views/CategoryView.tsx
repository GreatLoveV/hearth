import { useState, type CSSProperties } from "react";
import { api, type CategoryDetail, type RangeDay } from "../api";
import { BarList } from "../components/BarList";
import { Embers, hourCells } from "../components/Embers";
import { ResourcesPanel } from "../components/Resources";
import {
  addDays,
  appName,
  cleanTitle,
  colorOf,
  fmtChange,
  fmtClock,
  fmtDuration,
  fmtShortDate,
  heatDay,
  heatVar,
  isoDate,
  parseIso,
  today,
  useArrowKeys,
  useLoad,
  WEEKDAYS,
} from "../lib";
import { appHref, href, type Route } from "../router";
import { PeriodNav } from "./AppView";
import { MonthGrid, period, weekCells, YearGrid, type Kind } from "./Range";

const pct = (part: number, whole: number) => {
  const v = whole > 0 ? (part / whole) * 100 : 0;
  return v > 0 && v < 1 ? "<1%" : `${Math.round(v)}%`;
};

/**
 * One category on its own: the apps in it and how its time splits between them, when in the day and
 * week it happens, its window titles and sites, and what its apps cost in processor, memory and disk.
 */
export default function CategoryView({ name, kind, value }: { name: string; kind: Kind; value: string }) {
  const to = (k: Kind, v: string): Route => ({
    view: "category",
    name,
    kind: k,
    value: v,
  });
  const p = period(kind, value, to);
  const t = today();
  const firstIso = isoDate(p.first);
  const until = p.last > t ? t : p.last;
  const future = p.first > t;
  const [rev, setRev] = useState(0);
  useArrowKeys(p.prev, p.isCurrent ? () => {} : p.next);

  const load = useLoad(`category:${name}:${kind}:${firstIso}:${rev}`, () =>
    future ? Promise.resolve(null) : api.category(name, firstIso, isoDate(until)),
  );
  const data: CategoryDetail | null = load.data && load.data.start === firstIso && load.data.name === name ? load.data : null;
  const days = new Map<string, RangeDay>(data?.days.map((d) => [d.date, d]));
  const color = colorOf(data?.colors ?? {}, name);
  const change = data ? fmtChange(data.total, data.previous) : null;
  const avg = data && data.active_days ? data.total / data.active_days : 0;
  const busiest = data?.days.reduce<RangeDay | null>((b, d) => (!b || d.total > b.total ? d : b), null);
  const top = data?.apps[0];
  const loading = !data && !load.error && !future;
  const when = p.isCurrent ? p.eyebrow.toLowerCase() : kind === "month" ? `${p.title} ${p.eyebrow}` : p.title;

  return (
    <>
      <header className="page-head app-head">
        <div className="app-title">
          <span className="cat-mark" style={{ "--tint": color } as CSSProperties} aria-hidden="true">
            {name.charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="eyebrow">Category, {when}</p>
            <h1>{name}</h1>
          </div>
        </div>
        <PeriodNav kind={kind} p={p} to={to} />
      </header>

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
          {data && data.share > 0 && <p className="hero-change">{pct(data.total, data.everything)} of all your active time</p>}
          {loading && <p className="hint">Reading {name.toLowerCase()} history. The first time can take a few seconds.</p>}
        </div>
        <div className="hero-embers">
          {kind === "week" &&
            (data ? (
              <Embers key={`${name}${firstIso}`} cells={weekCells(p.first, days)} wide label={`Hours of ${name} per day`} />
            ) : (
              <Embers key="ash" cells={weekCells(p.first, new Map())} wide ash />
            ))}
          {kind === "month" && <MonthGrid first={p.first} last={p.last} days={days} />}
          {kind === "year" && <YearGrid first={p.first} last={p.last} days={days} />}
        </div>
        {data && data.total > 0 && (
          <dl className="facts">
            <div>
              <dt>Days with it</dt>
              <dd>
                {data.active_days} of {data.days.length}
              </dd>
            </div>
            <div>
              <dt>Average day</dt>
              <dd>{fmtDuration(avg)}</dd>
            </div>
            <div>
              <dt>Apps</dt>
              <dd>{data.app_count}</dd>
            </div>
            <div>
              <dt>Top app</dt>
              <dd>
                {top ? (
                  <a href={appHref(top.key, kind, value)}>
                    {appName(top.app)}, {pct(top.seconds, data.total)}
                  </a>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>Sessions</dt>
              <dd>
                {data.sessions}
                {data.sessions ? `, ${fmtDuration(data.total / data.sessions)} each on average` : ""}
              </dd>
            </div>
            <div>
              <dt>Longest stretch</dt>
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
              <dt>Change what counts</dt>
              <dd>
                <a href={href({ view: "settings", section: "categories" })}>Category rules</a>
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
            Nothing counted as {name.toLowerCase()} this {kind}.
          </p>
        </section>
      )}

      {data && data.total > 0 && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Apps</h2>
              <p className="muted">share of {name.toLowerCase()} time, and days used</p>
            </div>
            {data.apps.length > 1 && (
              <div className="share-strip" role="img" aria-label={`How ${name.toLowerCase()} time splits between apps`}>
                {data.apps.slice(0, 8).map((a, i) => (
                  <span
                    key={a.key}
                    title={`${appName(a.app)}, ${pct(a.seconds, data.total)}`}
                    style={{
                      flexGrow: a.seconds,
                      backgroundColor: color,
                      opacity: Math.max(0.3, 1 - i * 0.1),
                    }}
                  />
                ))}
              </div>
            )}
            <BarList
              label={`Time per app in ${name}`}
              limit={10}
              rows={data.apps.map((a) => ({
                id: a.key,
                label: appName(a.app),
                detail: `${pct(a.seconds, data.total)}, ${a.days} ${a.days === 1 ? "day" : "days"}`,
                seconds: a.seconds,
                color,
                icon: a.app,
                href: appHref(a.key, kind, value),
              }))}
            />
          </section>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>When it happens</h2>
                <p className="muted">average minutes per hour</p>
              </div>
              <Embers
                key={`r${name}${firstIso}`}
                cells={hourCells(data.rhythm)}
                still
                label={`Average minutes of ${name} per hour`}
              />
              <p className="hint rhythm-note">
                Averaged over the {data.active_days} {data.active_days === 1 ? "day" : "days"} with any {name.toLowerCase()}.
              </p>
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>By weekday</h2>
                <p className="muted">average day</p>
              </div>
              <BarList
                label={`Average ${name} per weekday`}
                limit={7}
                rows={WEEKDAYS.map((w, i) => ({
                  id: w,
                  label: w,
                  seconds: data.weekdays[i],
                  color: heatVar(Math.max(1, heatDay(data.weekdays[i]))),
                }))}
              />
            </section>
          </div>

          <div className={data.sites.length ? "grid-2" : undefined}>
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
            {data.sites.length > 0 && (
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
            )}
          </div>
        </>
      )}

      {!future && (
        <ResourcesPanel
          start={p.first.getTime() / 1000}
          end={addDays(p.last, 1).getTime() / 1000}
          period={when}
          category={name}
        />
      )}
    </>
  );
}
