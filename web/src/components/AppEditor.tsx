import { useEffect, useRef, useState } from "react";
import { api, type Categories, type Privacy } from "../api";
import { APP_PREFS_EVENT, appKey, appPrefs, defaultAppName, matchesPattern } from "../lib";
import { href } from "../router";
import { AppIcon } from "./AppIcon";

const OTHER = "Other";

/** The category an app's own rules put it in: the first category with a matching app pattern. */
function ruleCategory(cats: Categories, key: string): string {
  return cats.categories.find((c) => c.apps.some((p) => matchesPattern(p, key)))?.name ?? OTHER;
}

/** Rules that still match the app after its exact entries are removed: wildcards, mostly. */
const looseMatches = (patterns: string[], key: string) => patterns.filter((p) => appKey(p) !== key && matchesPattern(p, key));

/**
 * Change one app: the name it shows under, its icon, its category and whether Hearth hides it.
 * Name and icon are the app's own settings. Category and hiding edit your category and privacy
 * rules, the same lists as in Settings, so they also apply to history already recorded.
 */
export function AppEditor({ app, onClose, onSaved }: { app: string; onClose: () => void; onSaved: () => void }) {
  const key = appKey(app);
  const fallback = defaultAppName(app);
  const [name, setName] = useState(appPrefs(app)?.name ?? "");
  const [cats, setCats] = useState<Categories | null>(null);
  const [privacy, setPrivacy] = useState<Privacy | null>(null);
  const [category, setCategory] = useState<string>(OTHER);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [iconRev, setIconRev] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const first = useRef<HTMLInputElement>(null);
  const hasCustomIcon = (appPrefs(app)?.icon ?? 0) > 0;

  useEffect(() => {
    let alive = true;
    Promise.all([api.getSetting<Categories>("categories"), api.getSetting<Privacy>("privacy")])
      .then(([c, p]) => {
        if (!alive) return;
        setCats(c);
        setPrivacy(p);
        setCategory(ruleCategory(c, key));
        setHidden(p.apps.some((x) => matchesPattern(x, key)));
      })
      .catch((e: Error) => alive && setError(e.message));
    first.current?.focus();
    return () => {
      alive = false;
    };
  }, [key]);

  const refreshPrefs = () => window.dispatchEvent(new Event(APP_PREFS_EVENT));

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    setError(null);
    try {
      await api.uploadIcon(app, f);
      refreshPrefs();
      setIconRev((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (file.current) file.current.value = "";
    }
  };

  const resetIcon = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.resetIcon(app);
      refreshPrefs();
      setIconRev((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!cats || !privacy) return;
    setBusy(true);
    setError(null);
    setNote(null);
    const notes: string[] = [];
    try {
      const newName = name.trim() && name.trim() !== fallback ? name.trim() : null;
      if (newName !== (appPrefs(app)?.name ?? null)) await api.renameApp(app, newName);

      if (category !== ruleCategory(cats, key)) {
        const next: Categories = {
          ...cats,
          categories: cats.categories.map((c) => {
            const apps = c.apps.filter((p) => appKey(p) !== key);
            return { ...c, apps: c.name === category ? [...apps, key] : apps };
          }),
        };
        await api.putSetting("categories", next);
        const landed = ruleCategory(next, key);
        if (landed !== category) {
          const by = next.categories.find((c) => c.name === landed);
          notes.push(
            `A wider rule in ${landed} (${by ? looseMatches(by.apps, key).join(", ") : "a pattern"}) still claims it, so it stays in ${landed}. Change that rule in Settings, Categories.`,
          );
        }
      }

      const wasHidden = privacy.apps.some((x) => matchesPattern(x, key));
      if (hidden !== wasHidden) {
        const apps = privacy.apps.filter((x) => appKey(x) !== key);
        await api.putSetting("privacy", { ...privacy, apps: hidden ? [...apps, key] : apps });
        if (!hidden && looseMatches(apps, key).length)
          notes.push(
            `A wider privacy rule (${looseMatches(apps, key).join(", ")}) still hides it. Change it in Settings, Privacy.`,
          );
      }

      refreshPrefs();
      onSaved();
      if (notes.length) setNote(notes.join(" "));
      else onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel app-editor" aria-labelledby="app-editor-title">
      <div className="panel-head">
        <h2 id="app-editor-title">Edit app</h2>
        <p className="muted">
          <code>{key}</code>
        </p>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
      >
        <div className="field">
          <label htmlFor="app-name">Name</label>
          <p className="field-help" id="app-name-help">
            Shown everywhere in Hearth. Leave it empty for the usual name, {fallback}.
          </p>
          <input
            id="app-name"
            ref={first}
            value={name}
            maxLength={60}
            placeholder={fallback}
            aria-describedby="app-name-help"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="field">
          <span className="field-label" id="app-icon-label">
            Icon
          </span>
          <div className="icon-edit" role="group" aria-labelledby="app-icon-label">
            <AppIcon key={iconRev} app={app} size={48} />
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/x-icon,.ico"
              className="sr-only"
              id="app-icon-file"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => file.current?.click()}>
              Upload image
            </button>
            {hasCustomIcon && (
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={() => void resetIcon()}>
                Use the program's icon
              </button>
            )}
          </div>
          <p className="field-help">
            PNG, JPEG, WebP, GIF, BMP or ICO, up to 4 MB. It's fitted into a square. Applies straight away.
          </p>
        </div>

        <div className="field">
          <label htmlFor="app-category">Category</label>
          <p className="field-help" id="app-category-help">
            Moves the app in your category rules, so its past time moves too. Window titles that match a category's keywords still
            go to that category.
          </p>
          <select
            id="app-category"
            value={category}
            disabled={!cats}
            aria-describedby="app-category-help"
            onChange={(e) => setCategory(e.target.value)}
          >
            {(cats?.categories ?? []).map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
            <option value={OTHER}>Other</option>
          </select>
        </div>

        <label className="check">
          <input type="checkbox" checked={hidden} disabled={!privacy} onChange={(e) => setHidden(e.target.checked)} />
          <span>
            Hide this app
            <span className="check-help">
              Its time shows only as Private, with no name or window titles, including what's already recorded. Undo it here or in{" "}
              <a href={href({ view: "settings", section: "privacy" })}>Settings, Privacy</a>.
            </span>
          </span>
        </label>

        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {note && (
          <p className="hint" role="status">
            {note}
          </p>
        )}

        <div className="detail-actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !cats}>
            {busy ? "Saving" : "Save"}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            {note ? "Close" : "Cancel"}
          </button>
        </div>
      </form>
    </section>
  );
}
