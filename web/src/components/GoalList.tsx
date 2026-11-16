import type { Colors, GoalStatus } from "../api";
import { appName, colorOf, fmtDuration, heatVar } from "../lib";

function stateText(g: GoalStatus): string {
  const goal = g.minutes * 60;
  const left = goal - g.seconds;
  switch (g.state) {
    case "over":
      return `Over by ${fmtDuration(-left)}`;
    case "near":
    case "ok":
      return `${fmtDuration(left)} left`;
    case "done":
      return "Reached";
    default:
      return `${fmtDuration(left)} to go`;
  }
}

export function GoalList({ goals, colors }: { goals: GoalStatus[]; colors: Colors }) {
  const active = goals.filter((g) => g.state !== "off");
  if (!active.length)
    return (
      <p className="muted">
        {goals.length ? "No goals apply to this day." : "No goals yet."}{" "}
        <a href="#/settings/goals">{goals.length ? "Edit goals" : "Set a daily limit or target"}</a>
      </p>
    );

  return (
    <ul className="goals">
      {active.map((g) => {
        const ratio = Math.min(1, g.ratio);
        const fill =
          g.kind === "limit"
            ? heatVar(Math.min(6, 2 + Math.floor(g.ratio * 4)))
            : g.scope === "category"
              ? colorOf(colors, g.name)
              : "var(--action)";
        return (
          <li key={g.id} className="goal" data-state={g.state}>
            <div className="bar-head">
              <span className="bar-label">
                {g.scope === "app" ? appName(g.name) : g.name}
                <span className="bar-detail">{g.kind === "limit" ? "limit" : "target"}</span>
              </span>
              <span className="bar-value">
                {fmtDuration(g.seconds)} of {fmtDuration(g.minutes * 60)}
              </span>
            </div>
            <div
              className="goal-track"
              role="progressbar"
              aria-label={`${g.scope === "app" ? appName(g.name) : g.name} ${g.kind}`}
              aria-valuemin={0}
              aria-valuemax={g.minutes}
              aria-valuenow={Math.round(g.seconds / 60)}
            >
              <div className="goal-fill" style={{ width: `${ratio * 100}%`, backgroundColor: fill }} />
            </div>
            <p className="goal-state">{stateText(g)}</p>
          </li>
        );
      })}
    </ul>
  );
}
