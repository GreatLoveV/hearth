import { useEffect, useState, type ReactNode } from "react";
import { api, type Accuracy, type Categories, type Category, type Goal, type Goals, type Privacy, type Status } from "../api";
import { appKey, appName, fmtBytes, fmtClock, fmtDuration, fmtShortDate, isoDate, today, useLoad, WEEKDAYS } from "../lib";
import { href } from "../router";

const SECTIONS = [
  { id: "tracking", label: "Tracking" },
  { id: "categories", label: "Categories" },
  { id: "goals", label: "Goals" },
  { id: "privacy", label: "Privacy" },
  { id: "data", label: "Your data" },
];

// Shared pieces ------------------------------------------------------------------------

function useSetting<T>(key: string) {
  const [saved, setSaved] = useState<T | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    api
      .getSetting<T>(key)
      .then((v) => {
        setSaved(v);
        setDraft(v);
      })
      .catch((e: Error) => setError(e.message));
  }, [key]);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const update = (v: T) => {
    setDraft(v);
    setState("idle");
  };
  const save = async () => {
    if (!draft) return;
    setState("saving");
    setError(null);
    try {
      const v = await api.putSetting<T>(key, draft);
      setSaved(v);
      setDraft(v);
      setState("saved");
    } catch (e) {
      setError((e as Error).message.split("\n").slice(0, 3).join(" "));
      setState("idle");
    }
  };
  return { draft, update, dirty, save, reset: () => update(saved as T), error, state };
}

function SaveBar({
  s,
  savedText = "Saved.",
  invalid = null,
}: {
  s: { dirty: boolean; save: () => void; reset: () => void; error: string | null; state: string };
  savedText?: string;
  invalid?: string | null;
}) {
  if (s.error)
    return (
      <div className="save-bar" role="alert" data-error>
        <p>Couldn't save: {s.error}</p>
        <button className="btn btn-quiet" onClick={s.reset}>
          Undo changes
        </button>
      </div>
    );
  if (s.dirty)
    return (
      <div className="save-bar" data-error={invalid ? true : undefined}>
        <p id="save-problem">{invalid ?? "You have unsaved changes."}</p>
        <div className="row">
          <button
            className="btn btn-primary"
            onClick={s.save}
            disabled={s.state === "saving" || !!invalid}
            aria-describedby={invalid ? "save-problem" : undefined}
          >
            {s.state === "saving" ? "Saving" : "Save changes"}
          </button>
          <button className="btn btn-quiet" onClick={s.reset} disabled={s.state === "saving"}>
            Undo
          </button>
        </div>
      </div>
    );
  if (s.state === "saved")
    return (
      <p className="saved-note" role="status">
        {savedText}
      </p>
    );
  return null;
}

const parseLines = (text: string) =>
  text
    .split(/\n/)
    .map((x) => x.trim())
    .filter(Boolean);

/** A textarea holding one entry per line, kept in sync with a string list. */
function LinesField({
  id,
  label,
  help,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  help?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => {
    if (parseLines(text).join("\n") !== value.join("\n")) setText(value.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {help && (
        <p className="field-help" id={`${id}-help`}>
          {help}
        </p>
      )}
      <textarea
        id={id}
        value={text}
        rows={Math.min(8, Math.max(3, value.length + 1))}
        spellCheck={false}
        placeholder={placeholder}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseLines(e.target.value));
        }}
      />
    </div>
  );
}

function Loading({ error }: { error: string | null }) {
  return <p className={error ? "error-text" : "muted"}>{error ?? "Loading"}</p>;
}

// Tracking ---------------------------------------------------------------------------------

const STATE_TEXT: Record<Status["state"], string> = {
  recording: "Recording. Hearth is watching the active window and whether you're at the computer.",
  paused: "Paused. Nothing is recorded until you resume.",
  error: "Something's wrong: a watcher has stopped reporting. Restarting Hearth usually fixes it.",
  off: "This copy of Hearth runs without watchers, so it only shows history.",
};

function BrowserStatus() {
  const now = Date.now() / 1000;
  const info = useLoad("browser", async () => {
    const buckets = await api.buckets();
    const web = buckets.filter((b) => b.type === "web.tab.current");
    let last = 0;
    for (const b of web) {
      const ev = await api.events(b.id, now - 86400, now + 60);
      for (const e of ev) last = Math.max(last, e.start + e.duration);
    }
    return { count: web.length, last };
  });
  if (!info.data) return <Loading error={info.error} />;
  const { count, last } = info.data;
  if (!count)
    return (
      <p>
        <strong>Not connected.</strong> <span className="muted">Without it, browsers count as one app with no sites.</span>
      </p>
    );
  return (
    <p>
      <strong>Connected.</strong>{" "}
      <span className="muted">
        {last ? `Last tab seen ${fmtDuration(Math.max(0, now - last))} ago.` : "No tabs seen in the last day."}
      </span>
    </p>
  );
}

function TrackingSection() {
  const [rev, setRev] = useState(0);
  const status = useLoad(`st:${rev}`, api.status, 5000);
  const acc = useSetting<Accuracy>("accuracy");
  const st = status.data;
  const toggle = async () => {
    if (!st) return;
    await api.pause(st.state !== "paused").catch(() => {});
    setRev((r) => r + 1);
  };
  const a = acc.draft;
  const set = (patch: Partial<Accuracy>) => a && acc.update({ ...a, ...patch });

  return (
    <>
      <section className="panel">
        <h2>Recording</h2>
        {st ? (
          <div className="status-block">
            <p>{STATE_TEXT[st.state]}</p>
            {st.watcher_ages && Object.keys(st.watcher_ages).length > 0 && (
              <p className="hint">
                Window watcher checked {fmtDuration(st.watcher_ages.window ?? 0)} ago, presence watcher{" "}
                {fmtDuration(st.watcher_ages.afk ?? 0)} ago.
              </p>
            )}
            {(st.state === "recording" || st.state === "paused") && (
              <button className={`btn ${st.state === "paused" ? "btn-primary" : "btn-quiet"}`} onClick={toggle}>
                {st.state === "paused" ? "Resume recording" : "Pause recording"}
              </button>
            )}
          </div>
        ) : (
          <Loading error={status.error} />
        )}
      </section>

      <section className="panel">
        <h2>What counts as active</h2>
        <p className="section-help">
          Hearth counts you as away when there's no keyboard or mouse input for a while. These switches stop it from
          marking you away while you're clearly still there.
        </p>
        {a ? (
          <div className="form">
            <div className="field field-inline">
              <label htmlFor="afk">Away after</label>
              <input
                id="afk"
                type="number"
                min={1}
                max={60}
                value={a.afk_minutes}
                onChange={(e) => set({ afk_minutes: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })}
              />
              <span className="muted">minutes without input</span>
            </div>
            <label className="check">
              <input type="checkbox" checked={a.fullscreen_active} onChange={(e) => set({ fullscreen_active: e.target.checked })} />
              <span>
                Full-screen apps count as active
                <span className="check-help">Watching a film or playing a game without touching the mouse.</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={a.media_audio_active} onChange={(e) => set({ media_audio_active: e.target.checked })} />
              <span>
                Playing sound in a media app counts as active
                <span className="check-help">Video players, Spotify and the Media category, while they make sound.</span>
              </span>
            </label>
            <label className="check">
              <input type="checkbox" checked={a.controller_active} onChange={(e) => set({ controller_active: e.target.checked })} />
              <span>
                Game controller input counts as active
                <span className="check-help">Xbox-compatible controllers, read through XInput.</span>
              </span>
            </label>
            <p className="hint">Locking your computer always counts as away.</p>
            <SaveBar s={acc} savedText="Saved. New rules apply from now on." />
          </div>
        ) : (
          <Loading error={acc.error} />
        )}
      </section>

      <section className="panel">
        <h2>Browser tabs</h2>
        <p className="section-help">
          The Firefox extension tells Hearth which tab is open, so time in the browser is split by site.
        </p>
        <BrowserStatus />
        <ol className="steps">
          <li>
            Open <code>about:debugging#/runtime/this-firefox</code> in Firefox.
          </li>
          <li>
            Choose <strong>Load Temporary Add-on</strong> and pick <code>extensions\firefox\manifest.json</code> from the
            Hearth folder.
          </li>
          <li>
            Temporary add-ons are removed when Firefox closes. To keep it, see <code>extensions\firefox\README.md</code>.
          </li>
        </ol>
      </section>
    </>
  );
}

// Categories ---------------------------------------------------------------------------

function CategoryCard({
  c,
  index,
  count,
  onChange,
  onMove,
  onRemove,
}: {
  c: Category;
  index: number;
  count: number;
  onChange: (c: Category) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const id = `cat${index}`;
  return (
    <li className="tile">
      <div className="tile-head">
        <input
          className="color"
          type="color"
          value={c.color}
          aria-label={`Colour for ${c.name || "this category"}`}
          onChange={(e) => onChange({ ...c, color: e.target.value })}
        />
        <input
          className="name-input"
          value={c.name}
          maxLength={120}
          aria-label="Category name"
          onChange={(e) => onChange({ ...c, name: e.target.value })}
        />
        <div className="row">
          <button className="btn btn-quiet btn-icon btn-small" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${c.name} up`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 14.5 6-6 6 6" />
            </svg>
          </button>
          <button className="btn btn-quiet btn-icon btn-small" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={`Move ${c.name} down`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6 9.5 6 6 6-6" />
            </svg>
          </button>
          <button className="btn btn-quiet btn-small" onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div className="grid-2 tight">
        <LinesField
          id={`${id}-apps`}
          label="Apps"
          help="One per line. * matches anything, so steam* covers every Steam process."
          value={c.apps}
          onChange={(apps) => onChange({ ...c, apps })}
        />
        <LinesField
          id={`${id}-kw`}
          label="Words in a window title or site"
          help="One per line. These are checked before apps."
          value={c.keywords}
          onChange={(keywords) => onChange({ ...c, keywords })}
        />
      </div>
    </li>
  );
}

function categoryProblem(d: Categories): string | null {
  const names = d.categories.map((c) => c.name.trim().toLowerCase());
  const empty = names.indexOf("");
  if (empty >= 0) return `Category ${empty + 1} needs a name.`;
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) return `Two categories are called "${dup}". Give each a different name.`;
  if (names.includes("other") || names.includes("private")) return `"Other" and "Private" are used by Hearth itself. Pick another name.`;
  return null;
}

function goalProblem(d: Goals): string | null {
  const i = d.goals.findIndex((g) => !g.name.trim());
  if (i >= 0) return `Goal ${i + 1} needs an app name.`;
  const j = d.goals.findIndex((g) => g.days.length === 0);
  if (j >= 0) return `Goal ${j + 1} has no days picked, so it would never apply.`;
  return null;
}

function CategoriesSection() {
  const s = useSetting<Categories>("categories");
  const apps = useLoad("apps", api.apps);
  const d = s.draft;
  if (!d)
    return (
      <section className="panel">
        <Loading error={s.error} />
      </section>
    );

  const setCats = (categories: Category[]) => s.update({ ...d, categories });
  const listed = new Set(d.categories.flatMap((c) => c.apps.map((a) => a.toLowerCase())));
  const loose = (apps.data ?? []).filter((a) => !a.category && !listed.has(appKey(a.app))).slice(0, 30);

  return (
    <>
      <section className="panel">
        <h2>Categories</h2>
        <p className="section-help">
          Each app or window gets the first category that matches, from the top. Words in titles and sites are checked
          before app names. Changes apply to all your history, not just from now on.
        </p>
        <ul className="tiles">
          {d.categories.map((c, i) => (
            <CategoryCard
              key={i}
              c={c}
              index={i}
              count={d.categories.length}
              onChange={(next) => setCats(d.categories.map((x, j) => (j === i ? next : x)))}
              onMove={(dir) => {
                const next = [...d.categories];
                [next[i], next[i + dir]] = [next[i + dir], next[i]];
                setCats(next);
              }}
              onRemove={() => setCats(d.categories.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
        <div className="row spaced">
          <button
            className="btn btn-quiet"
            onClick={() => setCats([...d.categories, { name: "New category", color: "#c9a27a", apps: [], keywords: [] }])}
            disabled={d.categories.length >= 40}
          >
            Add a category
          </button>
          <label className="row other-color">
            <input type="color" className="color" value={d.other_color} onChange={(e) => s.update({ ...d, other_color: e.target.value })} />
            <span>Colour for Other</span>
          </label>
        </div>
        <SaveBar s={s} savedText="Saved. Every view now uses the new categories." invalid={categoryProblem(d)} />
      </section>

      <section className="panel">
        <h2>Apps without a category</h2>
        <p className="section-help">The apps you've used most that still count as Other.</p>
        {apps.data ? (
          loose.length ? (
            <ul className="loose">
              {loose.map((a) => (
                <li key={a.app}>
                  <span className="loose-name">
                    {appName(a.app)} <span className="muted">{appKey(a.app)}</span>
                  </span>
                  <span className="bar-value">{fmtDuration(a.seconds)}</span>
                  <select
                    aria-label={`Category for ${appName(a.app)}`}
                    value=""
                    onChange={(e) => {
                      const target = Number(e.target.value);
                      setCats(
                        d.categories.map((c, j) =>
                          j === target ? { ...c, apps: [...c.apps, appKey(a.app)] } : c,
                        ),
                      );
                    }}
                  >
                    <option value="" disabled>
                      Add to
                    </option>
                    {d.categories.map((c, j) => (
                      <option key={j} value={j}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Every app you use has a category.</p>
          )
        ) : (
          <Loading error={apps.error} />
        )}
        {s.dirty && <p className="hint">Remember to save the categories above.</p>}
      </section>
    </>
  );
}

// Goals ---------------------------------------------------------------------------------------

const newId = () => Math.random().toString(36).slice(2, 12).replace(/[^a-z0-9]/g, "") || "g1";

function GoalsSection() {
  const s = useSetting<Goals>("goals");
  const cats = useLoad("cats", () => api.getSetting<Categories>("categories"));
  const apps = useLoad("apps", api.apps);
  const d = s.draft;
  if (!d || !cats.data)
    return (
      <section className="panel">
        <Loading error={s.error ?? cats.error} />
      </section>
    );
  const names = [...cats.data.categories.map((c) => c.name), "Other"];
  const setGoals = (goals: Goal[]) => s.update({ goals });
  const edit = (i: number, patch: Partial<Goal>) => setGoals(d.goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));

  return (
    <section className="panel">
      <h2>Goals</h2>
      <p className="section-help">
        A limit warns you before you spend too long on something. A target tells you when you've done enough. The tray
        icon sends a notification at 80% of a limit, when you reach it, and when you hit a target.
      </p>
      <datalist id="app-list">
        {(apps.data ?? []).slice(0, 200).map((a) => (
          <option key={a.app} value={appKey(a.app)}>
            {appName(a.app)}
          </option>
        ))}
      </datalist>
      {d.goals.length === 0 && <p className="muted">No goals yet.</p>}
      <ul className="tiles">
        {d.goals.map((g, i) => {
          const id = `goal${i}`;
          return (
            <li key={g.id ?? i} className="tile goal-edit">
              <div className="goal-line">
                <select aria-label="Kind of goal" value={g.kind} onChange={(e) => edit(i, { kind: e.target.value as Goal["kind"] })}>
                  <option value="limit">At most</option>
                  <option value="target">At least</option>
                </select>
                <input
                  type="number"
                  className="num"
                  min={0}
                  max={24}
                  aria-label="Hours"
                  value={Math.floor(g.minutes / 60)}
                  onChange={(e) => edit(i, { minutes: Math.max(1, Math.min(1440, Number(e.target.value || 0) * 60 + (g.minutes % 60))) })}
                />
                <span>h</span>
                <input
                  type="number"
                  className="num"
                  min={0}
                  max={59}
                  step={5}
                  aria-label="Minutes"
                  value={g.minutes % 60}
                  onChange={(e) =>
                    edit(i, { minutes: Math.max(1, Math.min(1440, Math.floor(g.minutes / 60) * 60 + Math.min(59, Number(e.target.value || 0)))) })
                  }
                />
                <span>m of</span>
                <select
                  aria-label="Goal applies to"
                  value={g.scope}
                  onChange={(e) => {
                    const scope = e.target.value as Goal["scope"];
                    edit(i, { scope, name: scope === "category" ? names[0] : "" });
                  }}
                >
                  <option value="category">the category</option>
                  <option value="app">the app</option>
                </select>
                {g.scope === "category" ? (
                  <select aria-label="Category" value={g.name} onChange={(e) => edit(i, { name: e.target.value })}>
                    {!names.includes(g.name) && <option value={g.name}>{g.name}</option>}
                    {names.map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    aria-label="App"
                    list="app-list"
                    value={g.name}
                    maxLength={120}
                    placeholder="app name, like code"
                    onChange={(e) => edit(i, { name: e.target.value })}
                  />
                )}
                <button className="btn btn-quiet btn-small push" onClick={() => setGoals(d.goals.filter((_, j) => j !== i))}>
                  Remove
                </button>
              </div>
              <div className="days" role="group" aria-labelledby={`${id}-days`}>
                <span id={`${id}-days`} className="muted">
                  On
                </span>
                {WEEKDAYS.map((w, k) => {
                  const on = g.days.includes(k);
                  return (
                    <button
                      key={w}
                      className="day-toggle"
                      aria-pressed={on}
                      onClick={() => edit(i, { days: on ? g.days.filter((x) => x !== k) : [...g.days, k].sort() })}
                    >
                      {w}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="row spaced">
        <button
          className="btn btn-quiet"
          disabled={d.goals.length >= 50}
          onClick={() =>
            setGoals([
              ...d.goals,
              { id: newId(), kind: "limit", scope: "category", name: names.includes("Games") ? "Games" : names[0], minutes: 120, days: [0, 1, 2, 3, 4, 5, 6] },
            ])
          }
        >
          Add a goal
        </button>
      </div>
      <SaveBar s={s} savedText="Saved. The Day view shows how you're doing." invalid={goalProblem(d)} />
    </section>
  );
}

// Privacy ----------------------------------------------------------------------------------------

function PrivacySection() {
  const s = useSetting<Privacy>("privacy");
  const d = s.draft;
  return (
    <section className="panel">
      <h2>Privacy</h2>
      <p className="section-help">
        Everything Hearth records stays in one file on this computer and is only reachable from this computer. These
        rules hide things you'd rather not keep, now and in the history already recorded.
      </p>
      {d ? (
        <div className="form">
          <LinesField
            id="priv-apps"
            label="Apps to keep private"
            help="One per line, * matches anything. Their time is kept but shown as Private, with no app name or title."
            value={d.apps}
            placeholder="keepass*"
            onChange={(apps) => s.update({ ...d, apps })}
          />
          <LinesField
            id="priv-kw"
            label="Words that hide a window title"
            help="One per line. A window or site whose title or address contains one of these keeps its app but loses its title and site."
            value={d.keywords}
            onChange={(keywords) => s.update({ ...d, keywords })}
          />
          <p className="hint">Private and incognito browser windows are never recorded with a title.</p>
          <SaveBar s={s} savedText="Saved. Matching titles are now hidden everywhere." />
        </div>
      ) : (
        <Loading error={s.error} />
      )}
    </section>
  );
}

// Data ----------------------------------------------------------------------------------------------

const toLocalInput = (t: number) => {
  const d = new Date(t * 1000);
  return `${isoDate(d)}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const fromLocalInput = (s: string) => (s ? new Date(s).getTime() / 1000 : NaN);
const fmtMoment = (t: number) => `${fmtShortDate(new Date(t * 1000))}, ${fmtClock(t)}`;

function ForgetPanel() {
  const now = () => Math.floor(Date.now() / 1000);
  const [range, setRange] = useState<{ start: number; end: number; label: string } | null>(null);
  const [from, setFrom] = useState(() => toLocalInput(now() - 3600));
  const [to, setTo] = useState(() => toLocalInput(now()));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const pick = (start: number, end: number, label: string) => {
    setResult(null);
    setRange({ start, end, label });
  };
  const presets: [string, () => [number, number]][] = [
    ["The last 15 minutes", () => [now() - 900, now()]],
    ["The last hour", () => [now() - 3600, now()]],
    ["Today", () => [today().getTime() / 1000, now()]],
  ];
  const run = async () => {
    if (!range) return;
    setBusy(true);
    try {
      const r = await api.forget(range.start, range.end);
      setResult({ ok: true, text: `Done. ${r.changed} ${r.changed === 1 ? "record was" : "records were"} removed or trimmed.` });
      setRange(null);
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const custom = [fromLocalInput(from), fromLocalInput(to)];
  const customOk = custom[0] < custom[1];

  return (
    <section className="panel">
      <h2>Forget a stretch of time</h2>
      <p className="section-help">
        Removes everything recorded in that time: windows, presence and browser tabs. It can't be brought back, although
        backups made earlier still contain it.
      </p>
      <div className="row wrap">
        {presets.map(([label, get]) => (
          <button key={label} className="btn btn-quiet" onClick={() => pick(...get(), label.toLowerCase())}>
            {label}
          </button>
        ))}
      </div>
      <div className="row wrap custom-range">
        <div className="field">
          <label htmlFor="f-from">From</label>
          <input id="f-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="f-to">To</label>
          <input id="f-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <button
          className="btn btn-quiet"
          disabled={!customOk}
          onClick={() => pick(custom[0], custom[1], `${fmtMoment(custom[0])} to ${fmtMoment(custom[1])}`)}
        >
          Forget this range
        </button>
      </div>
      {!customOk && <p className="error-text">The range has to end after it starts.</p>}
      {range && (
        <div className="confirm" role="alert">
          <p>
            Delete everything recorded from {fmtMoment(range.start)} to {fmtMoment(range.end)}? This can't be undone.
          </p>
          <div className="confirm-actions">
            <button className="btn btn-danger" onClick={run} disabled={busy}>
              {busy ? "Deleting" : "Delete it"}
            </button>
            <button className="btn btn-quiet" onClick={() => setRange(null)} disabled={busy}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {result && (
        <p className={result.ok ? "saved-note" : "error-text"} role="status">
          {result.text}
        </p>
      )}
    </section>
  );
}

function DataSection() {
  const status = useLoad("st-data", api.status);
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const st = status.data;
  const params = new URLSearchParams({ format });
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const badRange = !!start && !!end && start > end;

  return (
    <>
      <section className="panel">
        <h2>Storage and backups</h2>
        {st ? (
          <dl className="kv">
            <div>
              <dt>Database</dt>
              <dd>
                {fmtBytes(st.db_bytes)} <code>{st.db_path}</code>
              </dd>
            </div>
            <div>
              <dt>Last backup</dt>
              <dd>
                {st.last_backup
                  ? `${fmtMoment(st.last_backup.time)}, ${fmtBytes(st.last_backup.bytes)} compressed`
                  : "None yet. The first one is made a few minutes after Hearth starts."}
              </dd>
            </div>
            <div>
              <dt>Backups kept</dt>
              <dd>
                {st.backup_count} of 7. One a day, in <code>{st.last_backup ? st.last_backup.path.replace(/[\\/][^\\/]+$/, "") : "~\\.hearth\\backups"}</code>
              </dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{st.version}</dd>
            </div>
          </dl>
        ) : (
          <Loading error={status.error} />
        )}
      </section>

      <section className="panel">
        <h2>Export</h2>
        <p className="section-help">Every recorded event, one per row, with its app, title, address and presence.</p>
        <div className="row wrap custom-range">
          <div className="field">
            <label htmlFor="x-format">Format</label>
            <select id="x-format" value={format} onChange={(e) => setFormat(e.target.value as "csv" | "json")}>
              <option value="csv">CSV, for spreadsheets</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="x-start">From</label>
            <input id="x-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="x-end">To</label>
            <input id="x-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          {badRange ? (
            <span className="btn btn-primary" aria-disabled="true" data-disabled>
              Download
            </span>
          ) : (
            <a className="btn btn-primary" href={`/api/export?${params}`} download>
              Download
            </a>
          )}
        </div>
        <p className="hint">{badRange ? "The range has to end after it starts." : "Leave the dates empty to export everything."}</p>
      </section>

      <ForgetPanel />
    </>
  );
}

// Page ---------------------------------------------------------------------------------------

export default function Settings({ section }: { section: string }) {
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];
  let body: ReactNode;
  switch (current.id) {
    case "categories":
      body = <CategoriesSection />;
      break;
    case "goals":
      body = <GoalsSection />;
      break;
    case "privacy":
      body = <PrivacySection />;
      break;
    case "data":
      body = <DataSection />;
      break;
    default:
      body = <TrackingSection />;
  }
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>{current.label}</h1>
        </div>
      </header>
      <div className="settings">
        <nav className="subnav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={href({ view: "settings", section: s.id })} aria-current={s.id === current.id ? "page" : undefined}>
              {s.label}
            </a>
          ))}
        </nav>
        <div className="settings-body" key={current.id}>
          {body}
        </div>
      </div>
    </>
  );
}
