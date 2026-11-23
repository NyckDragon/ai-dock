import { absoluteDate, formatPace, formatReset } from "../lib/format";
import { t, trLabel } from "../lib/i18n";
import { clampPercent, displayWord, quotaTone, shownPercent, timeMarkPercent, windowElapsedPercent, windowPace } from "../lib/quota";
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
  if (window.amount) {
    const label = trLabel(window.label);
    return (
      <div className={"quota-row" + (compact ? " quota-row--compact" : "")}>
        <div className="quota-row__labels">
          <span className="quota-row__name">{label}</span>
          <strong>{window.amount}</strong>
        </div>
      </div>
    );
  }

  const remaining = clampPercent(window.remainingPercent);
  const value = shownPercent(remaining, display, providerId);
  const word = displayWord(display, providerId);
  const tone = quotaTone(remaining);
  const pace = stale ? null : formatPace(windowPace(window, now));
  const timeMark = stale ? null : timeMarkPercent(window, display, providerId, now);
  const elapsed = timeMark == null ? null : windowElapsedPercent(window, now);
  const markHint =
    elapsed == null
      ? undefined
      : t("O traço branco marca o tempo: já passou {time}% desta janela e você usou {used}%. Se a barra passar do traço, o ritmo está acima do normal.", {
          time: String(Math.round(elapsed)),
          used: String(Math.round(100 - remaining))
        });
  const exact = absoluteDate(window.resetAt);
  const label = trLabel(window.label);

  const modelColor =
    window.id.startsWith("gemini")
      ? "#38bdf8"
      : window.id.startsWith("claude-gpt") || window.id.startsWith("third-party")
        ? "#c084fc"
        : window.id.startsWith("argon")
          ? "#34d399"
          : null;

  return (
    <div className={"quota-row" + (compact ? " quota-row--compact" : "")}>
      <div className="quota-row__labels">
        <span className="quota-row__name">
          {modelColor ? (
            <i
              className="quota-row__dot"
              style={{ backgroundColor: modelColor, boxShadow: `0 0 5px ${modelColor}` }}
              aria-hidden="true"
            />
          ) : null}
          {label}
        </span>
        <strong>
          {value}% <small>{word}</small>
        </strong>
      </div>
      <div className="quota-track-wrap" tabIndex={markHint ? 0 : undefined}>
        <div
          className={"quota-track quota-track--" + tone}
          role="meter"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={value}
          aria-valuetext={value + "% " + word}
        >
          <i
            style={{
              width: value + "%",
              backgroundColor: tone === "good" && modelColor ? modelColor : undefined
            }}
          />
          {timeMark != null ? (
            <b
              className="quota-track__tick"
              style={{ left: timeMark + "%" }}
              aria-hidden="true"
            />
          ) : null}
        </div>
        {markHint ? (
          <span className="quota-tip" role="tooltip">
            {markHint}
          </span>
        ) : null}
      </div>
      <div className="quota-row__meta">
        <span title={exact ? t("Reset {date}", { date: exact }) : undefined}>{formatReset(window.resetAt, now)}</span>
        {pace ? <span className={"pace pace--" + pace.tone}>{pace.text}</span> : null}
      </div>
    </div>
  );
}
