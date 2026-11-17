import { useEffect, useRef, useState } from "react";
import { api, type SearchHit } from "../api";
import { BarList } from "../components/BarList";
import { appName, cleanTitle, colorOf, fmtDuration, fmtShortDate, parseIso, useLoad } from "../lib";
import { go, href } from "../router";

const fmtDay = (iso: string) => fmtShortDate(parseIso(iso)!);
const fmtWhen = (t: number) => {
  const d = new Date(t * 1000);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" });
};

function Hit({ hit, color }: { hit: SearchHit; color: string }) {
  const [open, setOpen] = useState(false);
  const days = [...hit.days].reverse();
  const shown = open ? days : days.slice(0, 6);
  const title = cleanTitle(hit.title) || hit.domain || appName(hit.app);
  return (
    <li className="hit">
      <div className="hit-head">
        <span className="swatch" style={{ background: color }} aria-hidden="true" />
        <div className="hit-text">
          <p className="hit-title">{title}</p>
          <p className="hit-sub">
            {appName(hit.app)}
            {hit.domain && title !== hit.domain ? `, ${hit.domain}` : ""}
            <span className="muted">
              {" "}
              {hit.category}. Seen on {hit.day_count} {hit.day_count === 1 ? "day" : "days"},{" "}
              {hit.day_count === 1 ? fmtWhen(hit.first) : `${fmtWhen(hit.first)} to ${fmtWhen(hit.last)}`}
            </span>
          </p>
        </div>
        <p className="hit-total">{fmtDuration(hit.seconds)}</p>
      </div>
      <ul className="hit-days" aria-label={`Days with ${title}`}>
        {shown.map((d) => (
          <li key={d.date}>
            <a href={href({ view: "day", date: d.date })}>
              {fmtDay(d.date)} <span>{fmtDuration(d.seconds)}</span>
            </a>
          </li>
        ))}
        {days.length > 6 && (
          <li>
            <button className="linkish" onClick={() => setOpen(!open)} aria-expanded={open}>
              {open ? "Fewer days" : `${days.length - 6} more ${days.length - 6 === 1 ? "day" : "days"}`}
            </button>
          </li>
        )}
      </ul>
      {hit.day_count > hit.days.length && (
        <p className="hint">Showing the {hit.days.length} most recent days.</p>
      )}
    </li>
  );
}

export default function Search({ q }: { q: string }) {
  const [text, setText] = useState(q);
  const [more, setMore] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const query = q.trim();
  const ready = query.length >= 2;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return;
    const id = setTimeout(() => go({ view: "search", q: text }, true), 350);
    return () => clearTimeout(id);
  }, [text, q]);

  const res = useLoad(`search:${query}`, () => (ready ? api.search(query) : Promise.resolve(null)));
  const data = res.fresh ? res.data : null;
  const busy = ready && !res.fresh;
  useEffect(() => setMore(false), [query]);

  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">All of your history</p>
          <h1>Search</h1>
        </div>
      </header>

      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go({ view: "search", q: text }, true);
        }}
      >
        <label className="sr-only" htmlFor="q">
          Search window titles, apps and sites
        </label>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6" />
          <path d="m15 15 5.5 5.5" />
        </svg>
        <input
          id="q"
          ref={input}
          type="search"
          value={text}
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          placeholder="A window title, an app or a site, like github.com"
          onChange={(e) => setText(e.target.value)}
        />
      </form>

      <div aria-live="polite">
        {!ready && (
          <section className="panel notice">
            <p>Type at least two letters. Search looks through every window title, app name and site Hearth has seen, including what you imported from ActivityWatch.</p>
          </section>
        )}
        {busy && <p className="hint">Searching</p>}
        {res.error && res.fresh && (
          <section className="panel notice" role="alert">
            <p>{res.error}</p>
          </section>
        )}
        {data && data.results.length === 0 && (
          <section className="panel notice">
            <p>Nothing matches "{data.query}". Private windows and excluded apps are never searched.</p>
          </section>
        )}
      </div>

      {data && data.results.length > 0 && (
        <div className="search-layout">
          <section className="panel">
            <div className="panel-head">
              <h2>
                {fmtDuration(data.total)} matching "{data.query}"
              </h2>
              <p className="muted">
                {data.results.length}
                {data.results.length >= 60 ? "+" : ""} {data.results.length === 1 ? "match" : "matches"}
              </p>
            </div>
            {data.truncated && (
              <p className="hint search-note">This matched a lot of history, so only part of it was read and the totals may be low. A longer phrase narrows it down.</p>
            )}
            <ul className="hits">
              {(more ? data.results : data.results.slice(0, 20)).map((h, i) => (
                <Hit key={`${h.app}-${h.title}-${h.domain}-${i}`} hit={h} color={colorOf(data.colors, h.category)} />
              ))}
            </ul>
            {data.results.length > 20 && !more && (
              <button className="btn btn-quiet more" onClick={() => setMore(true)}>
                Show {data.results.length - 20} more
              </button>
            )}
          </section>
          <section className="panel">
            <div className="panel-head">
              <h2>In which apps</h2>
            </div>
            <BarList
              label="Matching time per app"
              rows={data.apps.map((a) => ({
                id: a.app,
                label: appName(a.app),
                seconds: a.seconds,
                color: colorOf(data.colors, a.category),
              }))}
            />
          </section>
        </div>
      )}
    </>
  );
}
