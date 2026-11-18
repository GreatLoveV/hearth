import { useEffect, useState } from "react";
import type { Colors } from "./api";

// Dates (local time) ------------------------------------------------------------

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  return addDays(x, -((x.getDay() + 6) % 7)); // weeks start on Monday
}

export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function parseIso(s: string | undefined): Date | null {
  const m = s?.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const today = () => startOfDay(new Date());

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Formatting ----------------------------------------------------------------------

export function fmtDuration(sec: number): string {
  if (sec < 60) return sec <= 0 ? "0m" : `${Math.round(sec)}s`;
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, "0")}m` : `${h}h`;
}

export const fmtClock = (t: number) =>
  new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const fmtLongDate = (d: Date) => d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
export const fmtShortDate = (d: Date) => d.toLocaleDateString([], { day: "numeric", month: "short" });

export function fmtChange(now: number, before: number): string | null {
  if (before < 600) return null; // nothing to compare with
  const diff = now - before;
  if (Math.abs(diff) < 60) return "about the same";
  return `${fmtDuration(Math.abs(diff))} ${diff > 0 ? "more" : "less"}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

const APP_NAMES: Record<string, string> = {
  code: "VS Code", cursor: "Cursor", devenv: "Visual Studio", claude: "Claude", opencode: "OpenCode",
  chrome: "Chrome", msedge: "Edge", firefox: "Firefox", brave: "Brave",
  windowsterminal: "Terminal", mintty: "Git Bash", powershell: "PowerShell", pwsh: "PowerShell", cmd: "Command Prompt",
  slack: "Slack", discord: "Discord", discordcanary: "Discord Canary", teams: "Teams", "ms-teams": "Teams",
  olk: "Outlook", outlook: "Outlook", "whatsapp.root": "WhatsApp", whatsapp: "WhatsApp", ayugram: "AyuGram", telegram: "Telegram",
  figma: "Figma", photoshop: "Photoshop", spotify: "Spotify", vlc: "VLC", "mpc-hc64": "MPC-HC", "mpc-hc": "MPC-HC",
  qbittorrent: "qBittorrent", winword: "Word", excel: "Excel", powerpnt: "PowerPoint", explorer: "File Explorer",
  notion: "Notion", obsidian: "Obsidian", searchhost: "Windows Search", shellhost: "Windows Shell",
  steamwebhelper: "Steam", steam: "Steam", medal: "Medal", valorant: "Valorant", dwrg: "Identity V",
  robloxplayerbeta: "Roblox", eldenring: "Elden Ring", tslgame: "PUBG", javaw: "Java (Minecraft)",
  fsd: "Deep Rock Galactic", fortniteclient: "Fortnite", ittakestwo_trial: "It Takes Two", outerwilds: "Outer Wilds",
  brawlhalla: "Brawlhalla", deadlock: "Deadlock", ryujinx: "Ryujinx", "riot client": "Riot Client",
  private: "Private", unknown: "Unknown app",
};

export type AppPrefs = { name: string | null; icon: number };

/** Fired after you change an app's name or icon, so the shell reloads them. */
export const APP_PREFS_EVENT = "hearth:apps";

// Names and icons you've set per app, keyed by app key. The shell loads them and calls setAppPrefs.
let prefs: Record<string, AppPrefs> = {};
export const setAppPrefs = (p: Record<string, AppPrefs>) => {
  prefs = p;
};
export const appPrefs = (app: string): AppPrefs | undefined => prefs[appKey(app)];

/** The name Hearth gives an app on its own, before any name you've set. */
export function defaultAppName(app: string): string {
  const base = app.replace(/\.exe$/i, "").replace(/-Win64-Shipping$/i, "");
  return APP_NAMES[base.toLowerCase()] ?? base.charAt(0).toUpperCase() + base.slice(1);
}

export function appName(app: string): string {
  return prefs[appKey(app)]?.name || defaultAppName(app);
}

export const appKey = (app: string) => app.toLowerCase().replace(/\.exe$/, "");

/** Whether an app key matches a rule pattern, where * is any run of characters and ? one. */
export function matchesPattern(pattern: string, key: string): boolean {
  const p = appKey(pattern.trim());
  const re = new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  return re.test(key);
}

const TITLE_SUFFIX =
  /\s[-–—]\s(Google Chrome|Microsoft Edge|Mozilla Firefox|Brave|Visual Studio Code|Figma|Word|Discord)$/;
export const cleanTitle = (title: string) => title.replace(TITLE_SUFFIX, "");

// Heat ----------------------------------------------------------------------------

/** Heat step 0-6 for seconds active in one hour: one step per 10 minutes. */
export const heatHour = (sec: number) => (sec <= 30 ? 0 : Math.min(6, Math.ceil(sec / 600)));

const DAY_STEPS = [0, 3600, 7200, 14400, 21600, 28800];
/** Heat step 0-6 for seconds active in one day (MASTER.md heat table). */
export function heatDay(sec: number): number {
  if (sec <= 60) return 0;
  let k = 1;
  for (let i = 1; i < DAY_STEPS.length; i++) if (sec >= DAY_STEPS[i]) k = i + 1;
  return Math.min(6, k);
}

export const heatVar = (k: number) => `var(--h${Math.max(0, Math.min(6, k))})`;

export const colorOf = (colors: Colors, category: string) => colors[category] ?? colors.Other ?? "#8a7d76";

// Hooks -----------------------------------------------------------------------------

export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Loads data for a key, keeps the last good result while the next loads, and optionally polls. */
export function useLoad<T>(key: string, load: () => Promise<T>, pollMs?: number) {
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({
    key: "",
    data: null,
    error: null,
  });
  useEffect(() => {
    let alive = true;
    const run = () =>
      load()
        .then((data) => alive && setState({ key, data, error: null }))
        .catch((e: Error) => alive && setState((s) => ({ ...s, key, error: e.message })));
    run();
    const id = pollMs ? setInterval(run, pollMs) : undefined;
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, pollMs]);
  return { data: state.data, error: state.error, fresh: state.key === key };
}

export function useArrowKeys(onPrev: () => void, onNext: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable], [data-arrows]")) return;
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPrev, onNext]);
}
