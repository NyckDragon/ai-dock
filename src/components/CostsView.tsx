import { RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTokens, formatUsd, summarizeCosts, type CostDay, type CostGroup } from "../lib/costs";
import { intlLocale, t, tr } from "../lib/i18n";
import type { CostReport } from "../types";
import { Segmented } from "./controls";
import { ProviderIcon } from "./ProviderIcon";

const RANGES = [1, 7, 30] as const;
const TOOL_NAMES: Record<string, string> = { claude: "Claude Code", codex: "Codex" };

function money(value: number, partial: boolean, locale: string) {
  return formatUsd(value, locale) + (partial ? "+" : "");
}

function DayColumns({ days, locale }: { days: CostDay[]; locale: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((day) => day.cost), 0);
  if (max <= 0) return null;
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: "2-digit", month: "short" }).format(new Date(date + "T12:00:00"));
  const focus = active != null ? days[active] : null;

  return (
    <figure className="cost-chart" aria-label={t("Custo estimado por dia")}>
      <div className="cost-chart__axis">
        <span>{formatUsd(max, locale)}</span>
        <span>{formatUsd(0, locale)}</span>
      </div>
      <div className="cost-chart__plot" onMouseLeave={() => setActive(null)}>
        {days.map((day, index) => (
          <button
            type="button"
            key={day.date}
            className={"cost-chart__slot" + (active === index ? " is-active" : "")}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            aria-label={dateLabel(day.date) + ": " + money(day.cost, day.partial, locale)}
          >
            <i style={{ height: day.cost > 0 ? Math.max(2, (day.cost / max) * 100) + "%" : 0 }} />
          </button>
        ))}
        {focus ? (
          <div
            className="cost-chart__tip"
            // Centered on the bar, kept inside the plot near the edges.
            style={{ left: Math.min(80, Math.max(20, ((active! + 0.5) / days.length) * 100)) + "%" }}
            role="status"
          >
            <strong>{money(focus.cost, focus.partial, locale)}</strong>
            <span>{dateLabel(focus.date)}</span>
            <span>{t("{tokens} tokens", { tokens: formatTokens(focus.tokens, locale) })}</span>
          </div>
        ) : null}
      </div>
      <figcaption className="cost-chart__dates">
        <span>{dateLabel(days[0].date)}</span>
        <span>{dateLabel(days[days.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}

function GroupTable({
  title,
  groups,
  locale,
  label,
  icon
}: {
  title: string;
  groups: CostGroup[];
  locale: string;
  label?: (key: string) => string;
  icon?: (key: string) => string | null;
}) {
  if (!groups.length) return null;
  const max = Math.max(...groups.map((group) => group.cost || group.tokens), 1);
  return (
    <section className="cost-table">
      <h3 className="settings-label">{title}</h3>
      <table>
        <thead className="sr-only">
          <tr>
            <th>{t("Nome")}</th>
            <th>{t("Custo estimado")}</th>
            <th>{t("Tokens")}</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const iconId = icon?.(group.key);
            return (
              <tr key={group.key}>
                <th scope="row">
                  <span className="cost-table__name">
                    {iconId ? <ProviderIcon providerId={iconId} size={14} brand /> : null}
                    <span title={group.key}>{label ? label(group.key) : group.key}</span>
                  </span>
                  <span className="cost-table__bar" aria-hidden="true">
                    <i style={{ width: ((group.cost || group.tokens) / max) * 100 + "%" }} />
                  </span>
                </th>
                <td>{group.cost > 0 || !group.partial ? money(group.cost, group.partial, locale) : "—"}</td>
                <td>{formatTokens(group.tokens, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

export function CostsView({
  report,
  loading,
  days,
  onDays,
  onReload
}: {
  report: CostReport | null;
  loading: boolean;
  days: number;
  onDays: (days: number) => void;
  onReload: () => void;
}) {
  const locale = intlLocale();
  const summary = useMemo(() => summarizeCosts(report?.entries || [], days), [report, days]);
  const rangeLabel = days === 1 ? t("Hoje") : t("Últimos {days} dias", { days });

  return (
    <section className="costs">
      <div className="search-row">
        <Segmented
          label={t("Período")}
          value={days}
          onChange={onDays}
          options={RANGES.map((value) => ({
            value,
            label: value === 1 ? t("Hoje") : t("{days} dias", { days: value })
          }))}
        />
        <button
          type="button"
          className={"icon-button" + (loading ? " is-spinning" : "")}
          onClick={onReload}
          aria-label={t("Recalcular custos")}
          title={t("Recalcular custos")}
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {!report && loading ? <div className="usage-card usage-card--skeleton" aria-hidden="true" /> : null}

      {report && report.files === 0 ? (
        <div className="empty-state">
          <span>{t("Nenhum log do Claude Code ou do Codex neste PC")}</span>
          <small>{t("Os custos aparecem quando você usa o Claude Code ou o Codex CLI neste computador.")}</small>
        </div>
      ) : null}

      {report && report.files > 0 ? (
        <>
          <div className="cost-hero">
            <span className="eyebrow">{rangeLabel}</span>
            <strong>{money(summary.total.cost, summary.total.partial, locale)}</strong>
            <small>{t("{tokens} tokens", { tokens: formatTokens(summary.total.tokens, locale) })}</small>
          </div>

          {days > 1 ? <DayColumns days={summary.days} locale={locale} /> : null}

          <GroupTable
            title={t("Por ferramenta")}
            groups={summary.providers}
            locale={locale}
            label={(key) => TOOL_NAMES[key] || key}
            icon={(key) => (key in TOOL_NAMES ? key : null)}
          />
          <GroupTable title={t("Modelos")} groups={summary.models} locale={locale} label={tr} />
          <GroupTable title={t("Projetos")} groups={summary.projects} locale={locale} label={tr} />

          <p className="hint">
            {t("Estimativa pelo preço público da API (tabela LiteLLM). Assinaturas não cobram por token: é quanto esse uso custaria na API.")}
            {summary.total.partial ? " " + t("\"+\" indica modelos sem preço na tabela, contados só em tokens.") : ""}
            {report.prices === "none" ? " " + t("Sem tabela de preços agora: mostrando só tokens.") : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
