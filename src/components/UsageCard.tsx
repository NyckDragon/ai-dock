import { AlertCircle, CheckCircle2 } from "lucide-react";
import { forwardRef } from "react";
import { historyKey, type UsageHistory } from "../lib/history";
import { displayWord, limitingWindow, quotaTone, shownPercent } from "../lib/quota";
import type { PercentDisplay, ProviderActivity, ProviderUsage } from "../types";
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
    history: UsageHistory;
    now: number;
    highlighted?: boolean;
    onConnect?: () => void;
  }
>(function UsageCard({ provider, activity, display, history, now, highlighted, onConnect }, ref) {
  const limiting = limitingWindow(provider);
  const headline = limiting ? shownPercent(limiting.remainingPercent, display) : null;
  const tone = quotaTone(limiting ? limiting.remainingPercent : null);
  const trend = limiting ? history[historyKey(provider.id, limiting.id)] : undefined;
  const showTrend = Boolean(limiting) && (provider.windows.length > 1 || (trend?.length || 0) > 1);

  return (
    <article
      ref={ref}
      className={"usage-card" + (highlighted ? " is-highlighted" : "")}
      aria-label={provider.name}
    >
      <div className="usage-card__top">
        <div className="usage-card__identity">
          <ProviderIcon providerId={provider.id} size={18} brand />
          <div>
            <div className="usage-card__name">{provider.name}</div>
            <div className={"usage-card__status" + (provider.connected ? "" : " is-off")}>
              {provider.connected ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
              {provider.connected ? "Conectado" : "Não conectado"}
              {provider.plan ? " · " + provider.plan : ""}
            </div>
          </div>
        </div>
        {limiting && headline != null ? (
          <div className="usage-card__headline">
            <strong className={"tone-text--" + tone}>{headline}%</strong>
            <small>{displayWord(display)}</small>
          </div>
        ) : null}
      </div>

      {limiting && showTrend ? (
        <div className="usage-card__trend">
          <span>{provider.windows.length > 1 ? "Limita: " + limiting.label : "Últimas 24h"}</span>
          <Sparkline points={trend} label={"Uso restante de " + limiting.label + " nas últimas 24 horas"} />
        </div>
      ) : null}

      {provider.error ? (
        <div className="notice notice--error">
          <span>{provider.error}</span>
          {onConnect && !provider.connected ? (
            <button type="button" className="text-button" onClick={onConnect}>
              Conectar
            </button>
          ) : null}
        </div>
      ) : null}

      {provider.windows.length ? (
        <div className="usage-card__windows">
          {provider.windows.map((window) => (
            <QuotaWindowRow key={window.id} window={window} display={display} now={now} />
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
