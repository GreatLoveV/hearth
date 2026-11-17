export type Colors = Record<string, string>;

export type Block = { start: number; end: number; app: string; category: string; title: string; domain: string };
export type AppRow = { app: string; seconds: number; category: string };
export type SiteRow = { domain: string; seconds: number; category: string };
export type CategoryRow = { name: string; seconds: number };

export type Summary = {
  start: number;
  end: number;
  total: number;
  apps: AppRow[];
  sites: SiteRow[];
  titles: { app: string; title: string; seconds: number }[];
  categories: CategoryRow[];
  hours: number[];
  timeline: Block[];
  first: number | null;
  last: number | null;
  longest: { app: string; seconds: number } | null;
  switches: number;
  current: { app: string; title: string; since: number } | null;
  colors: Colors;
};

export type RangeDay = { date: string; total: number; categories: Record<string, number>; first: number | null; last: number | null };

export type RangeData = {
  start: string;
  end: string;
  colors: Colors;
  total: number;
  active_days: number;
  days: RangeDay[];
  categories: CategoryRow[];
  apps: AppRow[];
  sites: SiteRow[];
  rhythm: number[];
  weekdays: number[];
  previous: { total: number; categories: Record<string, number> };
};

export type Goal = {
  id?: string;
  kind: "limit" | "target";
  scope: "category" | "app";
  name: string;
  minutes: number;
  days: number[];
};
export type GoalStatus = Required<Goal> & { seconds: number; ratio: number; state: "ok" | "near" | "over" | "done" | "pending" | "off" };

export type Status = {
  state: "recording" | "paused" | "error" | "off";
  stale: string[];
  watcher_ages: Record<string, number>;
  version: string;
  db_path: string;
  db_bytes: number;
  last_backup: { path: string; bytes: number; time: number } | null;
  backup_count: number;
};

export type Category = { name: string; color: string; apps: string[]; keywords: string[] };
export type Categories = { categories: Category[]; other_color: string };
export type Privacy = { apps: string[]; keywords: string[] };
export type Accuracy = { afk_minutes: number; fullscreen_active: boolean; media_audio_active: boolean; controller_active: boolean };
export type Goals = { goals: Goal[] };

export type SearchHit = {
  app: string;
  title: string;
  domain: string;
  category: string;
  seconds: number;
  first: number;
  last: number;
  day_count: number;
  days: { date: string; seconds: number }[];
};
export type SearchData = { query: string; total: number; results: SearchHit[]; apps: AppRow[]; truncated: boolean; colors: Colors };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new Error("Can't reach Hearth. Start it from the desktop shortcut, then try again.");
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* not JSON */
    }
    throw new Error(typeof detail === "string" ? detail : `Hearth answered ${res.status}.`);
  }
  return res.json();
}

const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const api = {
  summary: (start: number, end: number) => request<Summary>(`/api/summary?start=${start}&end=${end}`),
  range: (start: string, end: string) => request<RangeData>(`/api/range?start=${start}&end=${end}`),
  goals: (day: string) => request<GoalStatus[]>(`/api/goals/status?day=${day}`),
  status: () => request<Status>("/api/status"),
  pause: (paused: boolean) => request<Status>("/api/pause", send("POST", { paused })),
  apps: () => request<{ app: string; seconds: number; category: string | null }[]>("/api/apps"),
  buckets: () => request<{ id: string; type: string }[]>("/api/buckets"),
  events: (bucket: string, start: number, end: number) =>
    request<{ start: number; duration: number }[]>(
      `/api/buckets/${encodeURIComponent(bucket)}/events?start=${start}&end=${end}`,
    ),
  search: (q: string) => request<SearchData>(`/api/search?q=${encodeURIComponent(q)}`),
  getSetting: <T,>(key: string) => request<T>(`/api/settings/${key}`),
  putSetting: <T,>(key: string, value: T) => request<T>(`/api/settings/${key}`, send("PUT", value)),
  forget: (start: number, end: number) => request<{ changed: number }>("/api/forget", send("POST", { start, end })),
};
