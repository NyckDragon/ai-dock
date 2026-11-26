import { useMemo, useState } from "react";
import { formatTokens, formatUsd } from "../lib/costs";
import { buildHeatmap, type DailyStore, type HeatCell } from "../lib/heatmap";
import { t } from "../lib/i18n";
import { brandColorClass } from "./ProviderIcon";

const WEEKS = 26;

/**
 * Six months of use, one square per day, like Token Monitor's map: darker on
 * the heavier days. Hovering a day shows its spend in the header, inside the app.
 */
export function ActivityHeatmap({ store, tool, locale }: { store: DailyStore; tool: string; locale: string }) {
  const map = useMemo(() => buildHeatmap(store, tool, WEEKS), [store, tool]);
  const [focus, setFocus] = useState<HeatCell | null>(null);

  const dayText = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(new Date(date + "T12:00:00"));
  // Monday, Wednesday and Friday label their rows; 2026-11-01 was a Sunday.
  const weekdays = [1, 3, 5].map((offset) => ({ row: offset + 1, text: dayText(`2026-11-0${offset + 1}`, { weekday: "short" }) }));
  const focusText = focus
    ? focus.cost > 0 || focus.tokens > 0
      ? `${dayText(focus.date, { day: "numeric", month: "short" })} · ${formatUsd(focus.cost, locale)} · ${t("{tokens} tokens", { tokens: formatTokens(focus.tokens, locale) })}`
      : `${dayText(focus.date, { day: "numeric", month: "short" })} · ${t("sem uso")}`
    : t("Últimos 6 meses");

  return (
    <section className="detail-card heatmap" aria-label={t("Mapa de atividade")}>
      <div className="heatmap__head">
        <div>
          <span className="detail-card__label">{t("Atividade")}</span>
          <strong>{map.activeDays === 1 ? t("1 dia ativo") : t("{count} dias ativos", { count: String(map.activeDays) })}</strong>
        </div>
        <p className="heatmap__focus" aria-live="polite">
          {focusText}
        </p>
      </div>

      <div className={"heatmap__body " + (tool === "all" ? "heatmap--accent" : brandColorClass(tool))} onMouseLeave={() => setFocus(null)}>
        <div className="heatmap__months" aria-hidden="true">
          {map.months.map((month) => (
            <span key={month.date} style={{ gridColumn: month.column + 2 }}>
              {dayText(month.date, { month: "short" }).replace(".", "")}
            </span>
          ))}
        </div>
        <div className="heatmap__grid" role="img" aria-label={t("{count} dias ativos", { count: String(map.activeDays) })}>
          {weekdays.map((day) => (
            <span key={day.row} className="heatmap__weekday" style={{ gridRow: day.row, gridColumn: 1 }} aria-hidden="true">
              {day.text.replace(".", "")}
            </span>
          ))}
          {map.weeks.map((week, column) =>
            week.map((cell, row) =>
              cell ? (
                <span
                  key={cell.date}
                  className={"heatmap__cell heatmap__cell--" + cell.level + (focus?.date === cell.date ? " is-active" : "")}
                  style={{ gridColumn: column + 2, gridRow: row + 1 }}
                  onMouseEnter={() => setFocus(cell)}
                />
              ) : null
            )
          )}
        </div>
      </div>

      <div className="heatmap__foot">
        <p className="hint">{t("O dock guarda cada dia, então o mapa cresce com o uso.")}</p>
        <span className={"heatmap__legend " + (tool === "all" ? "heatmap--accent" : brandColorClass(tool))} aria-hidden="true">
          <span>{t("Menos")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={"heatmap__cell heatmap__cell--" + level} />
          ))}
          <span>{t("Mais")}</span>
        </span>
      </div>
    </section>
  );
}
