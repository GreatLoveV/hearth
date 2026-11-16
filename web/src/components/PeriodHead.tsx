import { useArrowKeys } from "../lib";

/** Page title with previous / current / next navigation. Left and right arrow keys step too. */
export function PeriodHead({
  eyebrow,
  title,
  unit,
  onPrev,
  onNext,
  onCurrent,
  isCurrent,
}: {
  eyebrow: string;
  title: string;
  unit: string;
  onPrev: () => void;
  onNext: () => void;
  onCurrent: () => void;
  isCurrent: boolean;
}) {
  useArrowKeys(onPrev, isCurrent ? () => {} : onNext);
  const current = unit === "day" ? "Today" : `This ${unit}`;
  return (
    <header className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="head-nav">
        <button className="btn btn-quiet btn-icon" onClick={onPrev} aria-label={`Previous ${unit}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m14.5 6-6 6 6 6" />
          </svg>
        </button>
        <button className="btn btn-quiet" onClick={onCurrent} disabled={isCurrent}>
          {current}
        </button>
        <button className="btn btn-quiet btn-icon" onClick={onNext} disabled={isCurrent} aria-label={`Next ${unit}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m9.5 6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </header>
  );
}
