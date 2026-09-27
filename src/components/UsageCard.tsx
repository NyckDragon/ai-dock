import { AlertCircle, CheckCircle2, History } from "lucide-react";
import { forwardRef } from "react";
import { formatAge } from "../lib/format";
import { historyKey, pointsInRange, type UsageHistory } from "../lib/history";
import { t, tr, trLabel } from "../lib/i18n";
import { displayWord, featuredWindow, quotaTone, shownPercent } from "../lib/quota";
import type { HeadlineWindow, HistoryRange, PercentDisplay, ProviderActivity, ProviderStatus, ProviderUsage } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { ProviderIcon } from "./ProviderIcon";
import { QuotaWindowRow } from "./QuotaWindowRow";
import { Sparkline } from "./Sparkline";
import { StatusBadge } from "./StatusBadge";

const RANGE_TEXT: Record<HistoryRange, () => string> = {
  "24h": () => t("Últimas 24h"),
  "7d": () => t("Últimos 7 dias"),
  "30d": () => t("Últimos 30 dias")
};

export const UsageCard = forwardRef<
  HTMLElement,
  {
    provider: ProviderUsage;
    activity?: ProviderActivity;
    display: PercentDisplay;
    headline: HeadlineWindow;
    history: UsageHistory;
    historyRange: HistoryRange;
    status?: ProviderStatus;
    now: number;
    highlighted?: boolean;
    onConnect?: () => void;
  }
>(function UsageCard({ provider, activity, display, headline: featured, history, historyRange, status, now, highlighted, onConnect }, ref) {
  const shown = featuredWindow(provider, featured);
  const headline = shown ? shownPercent(shown.remainingPercent, display, provider.id) : null;
  const tone = quotaTone(shown ? shown.remainingPercent : null);
  // Same scale as the big number: remaining or used, as the user chose.
  const trend = shown
    ? pointsInRange(history[historyKey(provider.id, shown.id)], historyRange, now)?.map(
        ([time, value]): [number, number] => [time, shownPercent(value, display, provider.id)]
      )
    : undefined;
  const displayKindUsed = shown ? shownPercent(0, display, provider.id) === 100 : false;
  const showTrend = Boolean(shown) && (provider.windows.length > 1 || (trend?.length || 0) > 1);

  return (
    <article
      ref={ref}
      className={"usage-card" + (highlighted ? " is-highlighted" : "") + (provider.stale ? " is-stale" : "")}
      aria-label={provider.name}
    >
      <div className="usage-card__top">
        <div className="usage-card__identity">
          <ProviderIcon providerId={provider.id} size={18} brand />
          <div>
            <div className="usage-card__name">{provider.name}</div>
            {provider.stale ? (
              <div className="usage-card__status is-stale">
                <History size={12} />
                {provider.updatedAt
                  ? t("Última leitura {age}", { age: formatAge(provider.updatedAt, now) })
                  : t("Última leitura salva")}
              </div>
            ) : (
              <div className={"usage-card__status" + (provider.connected ? "" : " is-off")}>
                {provider.connected ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {provider.connected ? t("Conectado") : t("Não conectado")}
                {provider.plan ? " · " + trLabel(provider.plan) : ""}
              </div>
            )}
          </div>
        </div>
        {shown && headline != null ? (
          <div className="usage-card__headline">
            <strong className={"tone-text--" + tone}>{headline}%</strong>
            <small>{displayWord(display, provider.id)}</small>
          </div>
        ) : null}
      </div>

      {shown && showTrend ? (
        <div className="usage-card__trend">
          <span>
            {provider.windows.length > 1 ? t("Em destaque: {window}", { window: trLabel(shown.label) }) : RANGE_TEXT[historyRange]()}
          </span>
          <Sparkline
            points={trend}
            highIsWorse={displayKindUsed}
            label={t("Histórico de {window} ({word}): {range}", { window: trLabel(shown.label), word: displayWord(display, provider.id), range: RANGE_TEXT[historyRange]() })}
          />
        </div>
      ) : null}

      {status ? <StatusBadge status={status} /> : null}

      {provider.error ? (
        <div className={"notice " + (provider.stale ? "notice--warning" : "notice--error")}>
          <span>{tr(provider.error)}</span>
          {onConnect && !provider.connected ? (
            <button type="button" className="text-button" onClick={onConnect}>
              {/expirou|inválid/i.test(provider.error) ? t("Reconectar") : t("Conectar")}
            </button>
          ) : null}
        </div>
      ) : null}

      {provider.windows.length ? (
        <div className="usage-card__windows">
          {provider.windows.map((window) => (
            <QuotaWindowRow key={window.id} window={window} providerId={provider.id} display={display} now={now} stale={provider.stale} />
          ))}
        </div>
      ) : null}

      <ActivityBlock activity={activity} now={now} />
    </article>
  );
});

export function UsageCardSkeleton() {
  return (
    <div className="usage-card usage-card--skeleton" aria-hidden="true">
      <div className="skeleton skeleton--line" style={{ width: "42%" }} />
      <div className="skeleton skeleton--line" style={{ width: "70%" }} />
      <div className="skeleton skeleton--bar" />
      <div className="skeleton skeleton--bar" />
    </div>
  );
}
