import { Clock3 } from "lucide-react";
import { useMemo, useState } from "react";
import { formatTokens, formatUsd } from "../lib/costs";
import { formatAge, formatPace, formatReset } from "../lib/format";
import { historyKey, type UsageHistory } from "../lib/history";
import { intlLocale, t, tr, trLabel } from "../lib/i18n";
import { costKeyFor, dailyCosts, dailyPeakUsed, quotaState, todayTotals, type DailyMetric, type QuotaState } from "../lib/providerDetail";
import { clampPercent, displayWord, featuredWindow, quotaTone, shownPercent, timeMarkPercent, windowPace } from "../lib/quota";
import { useCosts } from "../hooks/useCosts";
import type { HeadlineWindow, PercentDisplay, ProviderActivity, ProviderStatus, ProviderUsage, UsageWindow } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { ProviderChip } from "./ProviderIcon";
import { ProviderTabs } from "./ProviderTabs";
import { StatusBadge } from "./StatusBadge";

const DAYS = 30;

const STATE_TEXT: Record<QuotaState, string> = {
  healthy: "Saudável",
  warning: "Atenção",
  critical: "Crítico",
  depleted: "Esgotado",
  unknown: "Sem leitura"
};

/** One provider on its own page, like ClaudeBar's tiles: every window, today's spend, activity and 30 days. */
export function ProviderDetail({
  provider,
  providers,
  activity,
  activityFor,
  status,
  display,
  headline,
  history,
  now,
  onSelect,
  onBack
}: {
  provider: ProviderUsage;
  providers: ProviderUsage[];
  activity?: ProviderActivity;
  activityFor: (providerId: string) => ProviderActivity | undefined;
  status?: ProviderStatus;
  display: PercentDisplay;
  headline: HeadlineWindow;
  history: UsageHistory;
  now: number;
  onSelect: (providerId: string) => void;
  onBack: () => void;
}) {
  const locale = intlLocale();
  const logKey = costKeyFor(provider.id);
  const { report } = useCosts(logKey != null, DAYS);
  const entries = report?.entries ?? [];
  // No log line in 30 days means no local costs for it: show no zeros.
  const costKey = logKey && entries.some((entry) => entry.provider === logKey) ? logKey : null;
  const featured = featuredWindow(provider, headline);
  const worst = provider.windows.reduce<number | null>(
    (min, window) => (window.amount ? min : min == null ? window.remainingPercent : Math.min(min, window.remainingPercent)),
    null
  );
  const state = provider.connected || provider.stale ? quotaState(worst) : "unknown";
  const today = costKey ? todayTotals(entries, costKey) : null;

  const metrics: { id: DailyMetric; label: string }[] = costKey
    ? [
        { id: "cost", label: t("Custo") },
        { id: "tokens", label: t("Tokens") },
        { id: "cache", label: t("Cache") },
        { id: "peak", label: t("Pico de uso") }
      ]
    : [{ id: "peak", label: t("Pico de uso") }];
  const [metric, setMetric] = useState<DailyMetric>("cost");
  const shownMetric = metrics.some((item) => item.id === metric) ? metric : metrics[0].id;

  const series = useMemo(() => {
    if (shownMetric === "peak") {
      return featured ? dailyPeakUsed(history[historyKey(provider.id, featured.id)], DAYS) : [];
    }
    return costKey ? dailyCosts(entries, costKey, shownMetric, DAYS) : [];
  }, [shownMetric, featured, history, provider.id, costKey, entries]);

  const showChart = costKey != null || featured != null;

  return (
    <div className="provider-detail">
      <ProviderTabs
        providers={providers}
        selectedId={provider.id}
        display={display}
        headline={headline}
        activityFor={activityFor}
        onSelect={onSelect}
        onBack={onBack}
      />

      <header className="provider-detail__head">
        <ProviderChip providerId={provider.id} size={22} />
        <div className="provider-detail__title">
          <h2>{provider.name}</h2>
          <small>
            {provider.stale && provider.updatedAt
              ? t("Última leitura {age}", { age: formatAge(provider.updatedAt, now) })
              : provider.connected
                ? t("Conectado")
                : t("Não conectado")}
            {provider.plan ? " · " + trLabel(provider.plan) : ""}
            {provider.email ? " · " + provider.email : ""}
          </small>
        </div>
        <span className={"state-badge state-badge--" + (provider.stale ? "unknown" : state)}>
          <i aria-hidden="true" />
          {provider.stale ? t("Desatualizado") : t(STATE_TEXT[state])}
        </span>
      </header>

      {status ? <StatusBadge status={status} /> : null}
      {provider.error ? <div className="notice notice--warning">{tr(provider.error)}</div> : null}

      <section className="metric-grid" aria-label={t("Janelas de uso")}>
        {provider.windows.map((window) => (
          <WindowTile key={window.id} window={window} provider={provider} display={display} now={now} />
        ))}
        {today ? (
          <article className="metric-tile">
            <div className="metric-tile__head">
              <span>{t("Custo hoje")}</span>
              <span className="metric-tile__note">{t("estimado")}</span>
            </div>
            <div className="metric-tile__value">
              <strong>{formatUsd(today.cost, locale)}</strong>
              <small>{costKey === "antigravity" ? t("todas as contas") : t("pelo preço da API")}</small>
            </div>
            <p className="metric-tile__foot">
              {t("{tokens} tokens · {cache}% do cache", { tokens: formatTokens(today.tokens, locale), cache: String(today.cacheShare) })}
            </p>
          </article>
        ) : null}
      </section>

      {activity && activity.state !== "idle" ? (
        <section className="detail-card">
          <ActivityBlock activity={activity} now={now} limit={6} />
        </section>
      ) : null}

      {showChart ? (
      <section className="detail-card daily-chart">
        <div className="daily-chart__head">
          <div>
            <span className="detail-card__label">{t("Últimos {days} dias", { days: String(DAYS) })}</span>
            <strong>{totalText(series, shownMetric, locale)}</strong>
          </div>
          {metrics.length > 1 ? (
            <div className="segmented daily-chart__tabs" role="radiogroup" aria-label={t("Medida do gráfico")}>
              {metrics.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  role="radio"
                  aria-checked={item.id === shownMetric}
                  className={item.id === shownMetric ? "is-selected" : ""}
                  onClick={() => setMetric(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <DailyBars series={series} metric={shownMetric} locale={locale} />
        {shownMetric === "peak" ? (
          <p className="hint">{t("Maior uso de cada dia na janela em destaque, das leituras guardadas neste PC.")}</p>
        ) : costKey === "antigravity" ? (
          <p className="hint">{t("Os registros do Antigravity não separam as contas: o gráfico soma todas.")}</p>
        ) : null}
      </section>
      ) : null}
    </div>
  );
}

function WindowTile({ window, provider, display, now }: { window: UsageWindow; provider: ProviderUsage; display: PercentDisplay; now: number }) {
  const remaining = clampPercent(window.remainingPercent);
  const value = shownPercent(remaining, display, provider.id);
  const tone = quotaTone(remaining);
  const state = quotaState(remaining);
  const mark = provider.stale ? null : timeMarkPercent(window, display, provider.id, now);
  const pace = provider.stale ? null : formatPace(windowPace(window, now), now);

  if (window.amount) {
    return (
      <article className="metric-tile">
        <div className="metric-tile__head">
          <span>{trLabel(window.label)}</span>
        </div>
        <div className="metric-tile__value">
          <strong>{window.amount}</strong>
        </div>
      </article>
    );
  }

  return (
    <article className={"metric-tile" + (provider.stale ? " is-stale" : "")}>
      <div className="metric-tile__head">
        <span>{trLabel(window.label)}</span>
        <span className={"state-badge state-badge--small state-badge--" + state}>{t(STATE_TEXT[state])}</span>
      </div>
      <div className="metric-tile__value">
        <strong className={"tone-text--" + tone}>
          {value}
          <em>%</em>
        </strong>
        <small>{displayWord(display, provider.id)}</small>
      </div>
      <div className={"quota-track quota-track--" + tone}>
        <i style={{ width: value + "%" }} />
        {mark != null ? <b className="quota-track__tick" style={{ left: mark + "%" }} aria-hidden="true" /> : null}
      </div>
      <p className="metric-tile__foot">
        <span>
          <Clock3 size={12} aria-hidden="true" />
          {formatReset(window.resetAt, now)}
        </span>
        {pace ? <span className={"pace pace--" + pace.tone}>{pace.text}</span> : null}
      </p>
    </article>
  );
}

function totalText(series: { value: number }[], metric: DailyMetric, locale: string) {
  if (!series.length || series.every((day) => day.value === 0)) return "—";
  if (metric === "peak") return t("Pico de {value}%", { value: String(Math.round(Math.max(...series.map((day) => day.value)))) });
  const total = series.reduce((sum, day) => sum + day.value, 0);
  return metric === "cost" ? formatUsd(total, locale) : formatTokens(total, locale);
}

function DailyBars({ series, metric, locale }: { series: { date: string; value: number }[]; metric: DailyMetric; locale: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...series.map((day) => day.value));
  const format = (value: number) =>
    metric === "cost" ? formatUsd(value, locale) : metric === "peak" ? Math.round(value) + "%" : formatTokens(value, locale);
  const dateText = (date: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(date + "T12:00:00"));
  const focus = hover != null ? series[hover] : null;

  if (!series.length || series.every((day) => day.value === 0)) {
    return <p className="daily-chart__empty">{t("Ainda sem dados neste período.")}</p>;
  }

  return (
    <div className="daily-chart__body">
      <p className="daily-chart__focus" aria-live="polite">
        {focus ? `${dateText(focus.date)} · ${format(focus.value)}` : " "}
      </p>
      <div className="daily-chart__bars" onMouseLeave={() => setHover(null)}>
        {series.map((day, index) => (
          <span
            key={day.date}
            className={"daily-chart__bar" + (hover === index ? " is-active" : "")}
            onMouseEnter={() => setHover(index)}
          >
            <i style={{ height: Math.max(2, (day.value / max) * 100) + "%" }} />
          </span>
        ))}
      </div>
      <div className="daily-chart__dates">
        <span>{dateText(series[0].date)}</span>
        <span>{dateText(series[series.length - 1].date)}</span>
      </div>
    </div>
  );
}
