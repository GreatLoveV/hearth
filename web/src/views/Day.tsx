import { useState } from "react";
import { api, type Block } from "../api";
import { BarList } from "../components/BarList";
import { Embers, hourCells } from "../components/Embers";
import { PeriodHead } from "../components/PeriodHead";
import { Hearth } from "../components/Hearth";
import { GoalList } from "../components/GoalList";
import { Timeline, type Focus } from "../components/Timeline";
import {
  addDays,
  appName,
  cleanTitle,
  colorOf,
  fmtClock,
  fmtDuration,
  fmtLongDate,
  isoDate,
  parseIso,
  sameDay,
  today,
  useLoad,
  useNow,
} from "../lib";
import { appHref, categoryHref, go } from "../router";
import { AppIcon } from "../components/AppIcon";
import { ResourcesPanel } from "../components/Resources";

function eyebrow(day: Date): string {
  const t = today();
  if (sameDay(day, t)) return "Today";
  if (sameDay(day, addDays(t, -1))) return "Yesterday";
  return String(day.getFullYear());
}

/** Seconds active in roughly the last hour: this hour so far plus the unexpired part of the last one. */
function recentSeconds(hours: number[]): number {
  const d = new Date();
  const h = d.getHours();
  const left = 1 - d.getMinutes() / 60;
  return hours[h] + (h > 0 ? hours[h - 1] * left : 0);
}

function hottest(hours: number[]): number | undefined {
  const max = Math.max(...hours);
  return max > 30 ? hours.indexOf(max) : undefined;
}

export default function Day({ date }: { date: string }) {
  const day = parseIso(date) ?? today();
  const key = isoDate(day);
  const start = day.getTime() / 1000;
  const end = addDays(day, 1).getTime() / 1000;
  const isToday = sameDay(day, new Date());
  const [rev, setRev] = useState(0);
  const [focus, setFocus] = useState<Focus>(null);
  const now = useNow(30_000);

  const summary = useLoad(`${key}:${rev}`, () => api.summary(start, end), isToday ? 30_000 : undefined);
  const goals = useLoad(`goals:${key}:${rev}`, () => api.goals(key), isToday ? 60_000 : undefined);
  const s = summary.data?.start === start ? summary.data : null;

  const prev = () => go({ view: "day", date: isoDate(addDays(day, -1)) });
  const next = () => go({ view: "day", date: isoDate(addDays(day, 1)) });

  const forget = async (b: Block) => {
    await api.forget(b.start, b.end);
    setRev((r) => r + 1);
  };

  const colors = s?.colors ?? {};
  const appCategory = new Map(s?.apps.map((a) => [a.app, a.category]));

  return (
    <>
      <PeriodHead
        eyebrow={eyebrow(day)}
        title={fmtLongDate(day)}
        unit="day"
        onPrev={prev}
        onNext={next}
        onCurrent={() => go({ view: "day", date: isoDate(today()) })}
        isCurrent={isToday}
      />

      {summary.error && !s && (
        <section className="panel notice" role="alert">
          <p>{summary.error}</p>
          <button className="btn btn-quiet" onClick={() => setRev((r) => r + 1)}>
            Try again
          </button>
        </section>
      )}

      <section className="panel hero hero-scene" aria-label="The day as a fire, and by hour">
        <Hearth
          key={key}
          categories={s?.categories ?? []}
          total={s?.total ?? 0}
          colors={colors}
          live={isToday && !!s?.current}
          recent={s ? recentSeconds(s.hours) : 0}
        />
        <div className="hero-total">
          <p className="label">Active</p>
          <p className="figure">{s ? fmtDuration(s.total) : "–"}</p>
          {isToday && s?.current && (
            <p className="now-line">
              <span className="live-dot" aria-hidden="true" />
              Now in{" "}
              <a className="now-app" href={appHref(s.current.app)}>
                <AppIcon app={s.current.app} size={18} color={colorOf(colors, appCategory.get(s.current.app) ?? "Other")} />
                <strong>{appName(s.current.app)}</strong>
              </a>
              {s.current.title && <span className="now-title">{cleanTitle(s.current.title)}</span>}
              <span className="muted">for {fmtDuration(now - s.current.since)}</span>
            </p>
          )}
        </div>
        <div className="hero-embers">
          {s ? (
            <Embers key={key} cells={hourCells(s.hours)} hot={hottest(s.hours)} label="Minutes active per hour" />
          ) : (
            <Embers key="ash" cells={hourCells(Array(24).fill(0))} ash />
          )}
        </div>
          {s && s.total > 0 && (
          <dl className="facts">
            <div>
              <dt>Started</dt>
              <dd>{s.first ? fmtClock(s.first) : "–"}</dd>
            </div>
            <div>
              <dt>{isToday ? "Latest" : "Finished"}</dt>
              <dd>{s.last ? fmtClock(s.last) : "–"}</dd>
            </div>
            <div>
              <dt>Longest stretch</dt>
              <dd>
                {s.longest ? (
                  <>
                    {fmtDuration(s.longest.seconds)} in <a href={appHref(s.longest.app)}>{appName(s.longest.app)}</a>
                  </>
                ) : (
                  "–"
                )}
              </dd>
            </div>
            <div>
              <dt>Switches</dt>
              <dd>{s.switches}</dd>
            </div>
          </dl>
        )}
      </section>

      {s && s.total === 0 && (
        <section className="panel notice">
          <p>
            {isToday
              ? "Nothing recorded yet today. Time shows up here once you've been active for a minute."
              : "Nothing was recorded on this day."}
          </p>
        </section>
      )}

      {s && s.total > 0 && (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>Timeline</h2>
              <p className="muted">{s.timeline.length} blocks</p>
            </div>
            <Timeline
              key={key}
              blocks={s.timeline}
              start={start}
              end={end}
              colors={colors}
              focus={focus}
              now={isToday ? now : null}
              onForget={forget}
            />
          </section>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Apps</h2>
                <p className="muted">{s.apps.length} used</p>
              </div>
              <BarList
                label="Time per app"
                rows={s.apps.map((a) => ({
                  id: a.app,
                  label: appName(a.app),
                  detail: a.category,
                  seconds: a.seconds,
                  color: colorOf(colors, a.category),
                  icon: a.app,
                  href: appHref(a.app),
                }))}
                onFocus={(id) => setFocus(id ? { kind: "app", value: id } : null)}
              />
            </section>

            <div className="stack">
              <section className="panel">
                <div className="panel-head">
                  <h2>Categories</h2>
                </div>
                <BarList
                  label="Time per category"
                  rows={s.categories.map((c) => ({
                    id: c.name,
                    label: c.name,
                    seconds: c.seconds,
                    color: colorOf(colors, c.name),
                    href: categoryHref(c.name),
                  }))}
                  onFocus={(id) => setFocus(id ? { kind: "category", value: id } : null)}
                />
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Goals</h2>
                  <a className="muted" href="#/settings/goals">
                    Edit
                  </a>
                </div>
                {goals.data ? (
                  <GoalList goals={goals.data} colors={colors} />
                ) : (
                  <p className="muted">{goals.error ?? "Loading goals"}</p>
                )}
              </section>
            </div>
          </div>

          <div className="grid-2">
            <section className="panel">
              <div className="panel-head">
                <h2>Sites</h2>
              </div>
              <BarList
                label="Time per website"
                empty="No browser tabs recorded. Install the Firefox extension from Settings to see sites."
                rows={s.sites.map((w) => ({
                  id: w.domain,
                  label: w.domain,
                  seconds: w.seconds,
                  color: colorOf(colors, w.category),
                }))}
              />
            </section>
            <section className="panel">
              <div className="panel-head">
                <h2>Windows</h2>
              </div>
              <BarList
                label="Time per window title"
                empty="No window titles recorded."
                rows={s.titles.map((t) => ({
                  id: `${t.app}\n${t.title}`,
                  label: cleanTitle(t.title),
                  detail: appName(t.app) === cleanTitle(t.title) ? undefined : appName(t.app),
                  seconds: t.seconds,
                  color: colorOf(colors, appCategory.get(t.app) ?? "Other"),
                  icon: t.app,
                }))}
              />
            </section>
          </div>
        </>
      )}

      {s && <ResourcesPanel start={start} end={end} live={isToday} period={isToday ? "today so far" : "this day"} />}
    </>
  );
}
