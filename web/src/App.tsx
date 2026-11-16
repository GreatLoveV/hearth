import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { useLoad } from "./lib";
import { useRoute, type Route } from "./router";
import Day from "./views/Day";
import Range from "./views/Range";
import Search from "./views/Search";
import Settings from "./views/Settings";

const NAV: { view: Route["view"]; label: string; icon: ReactNode }[] = [
  {
    view: "day",
    label: "Day",
    icon: <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5" /></>,
  },
  { view: "week", label: "Week", icon: <path d="M4 18V12M8 18V8M12 18V10M16 18V6M20 18V13" /> },
  {
    view: "month",
    label: "Month",
    icon: <><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  },
  {
    view: "year",
    label: "Year",
    icon: <path d="M4 5h3v3H4zM10.5 5h3v3h-3zM17 5h3v3h-3zM4 10.5h3v3H4zM10.5 10.5h3v3h-3zM17 10.5h3v3h-3zM4 16h3v3H4zM10.5 16h3v3h-3z" />,
  },
  { view: "search", label: "Search", icon: <><circle cx="10.5" cy="10.5" r="6" /><path d="m15 15 5.5 5.5" /></> },
  {
    view: "settings",
    label: "Settings",
    icon: <path d="M4 7h9M17 7h3M4 17h3M11 17h9M15 4.5v5M9 14.5v5" />,
  },
];

const navHref = (view: Route["view"]): string => {
  switch (view) {
    case "day":
      return "#/day";
    case "week":
      return "#/week";
    case "month":
      return "#/month";
    case "year":
      return "#/year";
    case "search":
      return "#/search";
    case "settings":
      return "#/settings";
  }
};

const STATE_LABEL = { recording: "Recording", paused: "Paused", error: "Not recording", off: "Watchers off" };

function StatusButton() {
  const [rev, setRev] = useState(0);
  const [busy, setBusy] = useState(false);
  const status = useLoad(`status:${rev}`, api.status, 10_000);
  const state = status.error ? "offline" : status.data?.state;
  const paused = state === "paused";
  const label = state === "offline" ? "Offline" : state ? STATE_LABEL[state] : "Checking";
  const toggle = async () => {
    setBusy(true);
    try {
      await api.pause(!paused);
    } finally {
      setBusy(false);
      setRev((r) => r + 1);
    }
  };
  const canToggle = state === "recording" || state === "paused";
  return (
    <button
      className="status"
      data-state={state ?? "checking"}
      onClick={toggle}
      disabled={!canToggle || busy}
      aria-pressed={paused}
      title={paused ? "Resume recording" : canToggle ? "Pause recording" : (status.error ?? "")}
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-label">{label}</span>
      {canToggle && <span className="status-hint">{paused ? "Resume" : "Pause"}</span>}
    </button>
  );
}

function Rail({ route }: { route: Route }) {
  return (
    <nav className="rail" aria-label="Views">
      <a className="rail-mark" href="#/day" aria-label="Tracker, today">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <rect x="6" y="15" width="5" height="11" rx="2" fill="var(--h2)" />
          <rect x="13.5" y="9" width="5" height="17" rx="2" fill="var(--h4)" />
          <rect x="21" y="5" width="5" height="21" rx="2" fill="var(--h6)" />
        </svg>
      </a>
      <ul className="rail-list">
        {NAV.map((n) => (
          <li key={n.view}>
            <a className="rail-link" href={navHref(n.view)} aria-current={route.view === n.view ? "page" : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {n.icon}
              </svg>
              <span>{n.label}</span>
            </a>
          </li>
        ))}
      </ul>
      <StatusButton />
    </nav>
  );
}

export default function App() {
  const route = useRoute();
  useEffect(() => {
    const name = NAV.find((n) => n.view === route.view)?.label ?? "Day";
    document.title = `${name} | Tracker`;
  }, [route.view]);

  let view: ReactNode;
  switch (route.view) {
    case "day":
      view = <Day date={route.date} />;
      break;
    case "week":
      view = <Range kind="week" value={route.date} />;
      break;
    case "month":
      view = <Range kind="month" value={route.month} />;
      break;
    case "year":
      view = <Range kind="year" value={route.year} />;
      break;
    case "search":
      view = <Search q={route.q} />;
      break;
    case "settings":
      view = <Settings section={route.section} />;
      break;
  }

  return (
    <div className="shell">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Rail route={route} />
      <main className="main" id="main" tabIndex={-1}>
        <div className="view" key={route.view}>
          {view}
        </div>
      </main>
    </div>
  );
}
