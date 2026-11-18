import { useEffect, useState } from "react";
import { isoDate, today } from "./lib";

export type Route =
  | { view: "day"; date: string }
  | { view: "week"; date: string }
  | { view: "month"; month: string }
  | { view: "year"; year: string }
  | { view: "search"; q: string }
  | { view: "settings"; section: string }
  | { view: "app"; app: string; kind: "week" | "month" | "year"; value: string }
  | {
      view: "category";
      name: string;
      kind: "week" | "month" | "year";
      value: string;
    };

export function parse(hash: string): Route {
  const [view = "", arg = "", ...rest] = hash.replace(/^#\/?/, "").split("/");
  let value = "";
  try {
    value = decodeURIComponent(arg);
  } catch {
    value = "";
  }
  switch (view) {
    case "app":
    case "category": {
      const kind = rest[0] === "week" || rest[0] === "year" ? rest[0] : "month";
      const fallback =
        kind === "week" ? isoDate(today()) : kind === "year" ? String(today().getFullYear()) : isoDate(today()).slice(0, 7);
      if (!value) return { view: "day", date: isoDate(today()) };
      return view === "app"
        ? { view, app: value, kind, value: rest[1] || fallback }
        : { view, name: value, kind, value: rest[1] || fallback };
    }
    case "week":
      return { view, date: value || isoDate(today()) };
    case "month":
      return { view, month: value || isoDate(today()).slice(0, 7) };
    case "year":
      return { view, year: value || String(today().getFullYear()) };
    case "search":
      return { view, q: value };
    case "settings":
      return { view, section: value || "tracking" };
    default:
      return { view: "day", date: value || isoDate(today()) };
  }
}

export function href(r: Route): string {
  switch (r.view) {
    case "day":
      return `#/day/${r.date}`;
    case "week":
      return `#/week/${r.date}`;
    case "month":
      return `#/month/${r.month}`;
    case "year":
      return `#/year/${r.year}`;
    case "search":
      return `#/search/${encodeURIComponent(r.q)}`;
    case "settings":
      return `#/settings/${r.section}`;
    case "app":
      return `#/app/${encodeURIComponent(r.app)}/${r.kind}/${r.value}`;
    case "category":
      return `#/category/${encodeURIComponent(r.name)}/${r.kind}/${r.value}`;
  }
}

/** Link to an app's own page, for the current month unless a period is given. */
export const appHref = (app: string, kind: "week" | "month" | "year" = "month", value?: string): string =>
  value ? href({ view: "app", app, kind, value }) : `#/app/${encodeURIComponent(app)}`;

/** Link to a category's own page, for the current month unless a period is given. */
export const categoryHref = (name: string, kind: "week" | "month" | "year" = "month", value?: string): string =>
  value ? href({ view: "category", name, kind, value }) : `#/category/${encodeURIComponent(name)}`;

export const go = (r: Route, replace = false) => {
  if (replace) history.replaceState(null, "", href(r));
  else location.hash = href(r);
  if (replace) window.dispatchEvent(new HashChangeEvent("hashchange"));
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
