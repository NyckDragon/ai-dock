import { absoluteDate, formatPace, formatReset } from "../lib/format";
import { clampPercent, displayWord, quotaTone, shownPercent, windowPace } from "../lib/quota";
import type { PercentDisplay, UsageWindow } from "../types";

export function QuotaWindowRow({
  window,
  providerId,
  display,
  now,
  compact = false,
  stale = false
}: {
  window: UsageWindow;
  providerId: string;
  display: PercentDisplay;
  now: number;
  compact?: boolean;
  /** A last good reading: its pace would be projected from old numbers, so it is hidden. */
  stale?: boolean;
}) {
  const remaining = clampPercent(window.remainingPercent);
  const value = shownPercent(remaining, display, providerId);
  const word = displayWord(display, providerId);
  const tone = quotaTone(remaining);
  const pace = stale ? null : formatPace(windowPace(window, now));
  const exact = absoluteDate(window.resetAt);

  return (
    <div className={"quota-row" + (compact ? " quota-row--compact" : "")}>
      <div className="quota-row__labels">
        <span>{window.label}</span>
        <strong>
          {value}% <small>{word}</small>
        </strong>
      </div>
      <div
        className={"quota-track quota-track--" + tone}
        role="meter"
        aria-label={window.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={value + "% " + word}
      >
        <i style={{ width: value + "%" }} />
      </div>
      <div className="quota-row__meta">
        <span title={exact ? "Reset " + exact : undefined}>{formatReset(window.resetAt, now)}</span>
        {pace ? <span className={"pace pace--" + pace.tone}>{pace.text}</span> : null}
      </div>
    </div>
  );
}
