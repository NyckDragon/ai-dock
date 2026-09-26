import { absoluteDate, formatPace, formatReset } from "../lib/format";
import { clampPercent, displayWord, quotaTone, shownPercent, windowPace } from "../lib/quota";
import type { PercentDisplay, UsageWindow } from "../types";

export function QuotaWindowRow({
  window,
  display,
  now,
  compact = false
}: {
  window: UsageWindow;
  display: PercentDisplay;
  now: number;
  compact?: boolean;
}) {
  const remaining = clampPercent(window.remainingPercent);
  const value = shownPercent(remaining, display);
  const tone = quotaTone(remaining);
  const pace = formatPace(windowPace(window, now));
  const exact = absoluteDate(window.resetAt);

  return (
    <div className={"quota-row" + (compact ? " quota-row--compact" : "")}>
      <div className="quota-row__labels">
        <span>{window.label}</span>
        <strong>
          {value}% <small>{displayWord(display)}</small>
        </strong>
      </div>
      <div
        className={"quota-track quota-track--" + tone}
        role="meter"
        aria-label={window.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={value + "% " + displayWord(display)}
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
