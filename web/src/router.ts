import { useEffect, useState } from "react";
import { isoDate, today } from "./lib";

export type Route =
  | { view: "day"; date: string }
  | { view: "week"; date: string }
  | { view: "month"; month: string }
  | { view: "year"; year: string }
  | { view: "search"; q: string }
  | { view: "settings"; section: string };

export function parse(hash: string): Route {
  const [view = "", arg = ""] = hash.replace(/^#\/?/, "").split("/");
  let value = "";
  try {
    value = decodeURIComponent(arg);
  } catch {
    value = "";
  }
  switch (view) {
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
  }
}

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
