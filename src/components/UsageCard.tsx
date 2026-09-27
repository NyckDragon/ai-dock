import { AlertCircle, CheckCircle2, History } from "lucide-react";
import { forwardRef } from "react";
import { formatAge } from "../lib/format";
import { historyKey, type UsageHistory } from "../lib/history";
import { displayWord, featuredWindow, quotaTone, shownPercent } from "../lib/quota";
import type { HeadlineWindow, PercentDisplay, ProviderActivity, ProviderUsage } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { ProviderIcon } from "./ProviderIcon";
import { QuotaWindowRow } from "./QuotaWindowRow";
import { Sparkline } from "./Sparkline";

export const UsageCard = forwardRef<
  HTMLElement,
  {
    provider: ProviderUsage;
    activity?: ProviderActivity;
    display: PercentDisplay;
    headline: HeadlineWindow;
    history: UsageHistory;
    now: number;
    highlighted?: boolean;
    onConnect?: () => void;
  }
>(function UsageCard({ provider, activity, display, headline: featured, history, now, highlighted, onConnect }, ref) {
  const shown = featuredWindow(provider, featured);
  const headline = shown ? shownPercent(shown.remainingPercent, display, provider.id) : null;
  const tone = quotaTone(shown ? shown.remainingPercent : null);
  const trend = shown ? history[historyKey(provider.id, shown.id)] : undefined;
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
                Última leitura {provider.updatedAt ? formatAge(provider.updatedAt, now) : "salva"}
              </div>
            ) : (
              <div className={"usage-card__status" + (provider.connected ? "" : " is-off")}>
                {provider.connected ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {provider.connected ? "Conectado" : "Não conectado"}
                {provider.plan ? " · " + provider.plan : ""}
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
          <span>{provider.windows.length > 1 ? "Em destaque: " + shown.label : "Últimas 24h"}</span>
          <Sparkline points={trend} label={"Uso restante de " + shown.label + " nas últimas 24 horas"} />
        </div>
      ) : null}

      {provider.error ? (
        <div className={"notice " + (provider.stale ? "notice--warning" : "notice--error")}>
          <span>{provider.error}</span>
          {onConnect && !provider.connected ? (
            <button type="button" className="text-button" onClick={onConnect}>
              {/expirou|inválid/i.test(provider.error) ? "Reconectar" : "Conectar"}
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
