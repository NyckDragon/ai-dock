import { forwardRef } from "react";
import { formatAge } from "../lib/format";
import { t, tr, trLabel } from "../lib/i18n";
import type { PercentDisplay, ProviderActivity, ProviderStatus, ProviderUsage } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { ProviderIcon } from "./ProviderIcon";
import { QuotaWindowRow } from "./QuotaWindowRow";
import { StatusBadge } from "./StatusBadge";

export const ProviderPeek = forwardRef<
  HTMLElement,
  {
    provider: ProviderUsage;
    activity?: ProviderActivity;
    status?: ProviderStatus;
    updatedAt: number | null;
    display: PercentDisplay;
    now: number;
    onOpen: () => void;
  }
>(function ProviderPeek({ provider, activity, status: incident, updatedAt, display, now, onOpen }, ref) {
  const status = provider.stale
    ? (provider.updatedAt
        ? t("Última leitura {age}", { age: formatAge(provider.updatedAt, now) })
        : t("Última leitura salva")) +
      " · " +
      t("não atualizou")
    : updatedAt
      ? t("Atualizado {age}", { age: formatAge(updatedAt, now) })
      : t("Aguardando leitura");

  return (
    <aside ref={ref} className="provider-peek" onClick={onOpen} aria-label={provider.name}>
      <div className="provider-peek__head">
        <span className="provider-peek__brand">
          <ProviderIcon providerId={provider.id} size={18} brand />
          <span>
            <strong>{provider.name}</strong>
            <small>
              {status}
              {provider.plan ? " · " + trLabel(provider.plan) : ""}
            </small>
          </span>
        </span>
        <i className={"status-dot" + (provider.connected ? " status-dot--on" : "")} aria-hidden="true" />
      </div>

      {incident ? <StatusBadge status={incident} /> : null}

      {provider.error ? (
        <div className={"notice " + (provider.stale ? "notice--warning" : "notice--error")}>{tr(provider.error)}</div>
      ) : null}

      {provider.windows.length ? (
        <div className={"provider-peek__windows" + (provider.stale ? " is-stale" : "")}>
          {provider.windows.map((window) => (
            <QuotaWindowRow key={window.id} window={window} providerId={provider.id} display={display} now={now} compact stale={provider.stale} />
          ))}
        </div>
      ) : null}

      <ActivityBlock activity={activity} now={now} />

      <button
        type="button"
        className="provider-peek__open"
        onClick={(event) => {
          event.stopPropagation();
          onOpen();
        }}
      >
        {t("Abrir no painel")}
      </button>
    </aside>
  );
});
