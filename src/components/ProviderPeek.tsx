import { forwardRef } from "react";
import { formatAge } from "../lib/format";
import type { PercentDisplay, ProviderActivity, ProviderUsage } from "../types";
import { ActivityBlock } from "./ActivityBlock";
import { ProviderIcon } from "./ProviderIcon";
import { QuotaWindowRow } from "./QuotaWindowRow";

export const ProviderPeek = forwardRef<
  HTMLElement,
  {
    provider: ProviderUsage;
    activity?: ProviderActivity;
    updatedAt: number | null;
    display: PercentDisplay;
    now: number;
    onOpen: () => void;
  }
>(function ProviderPeek({ provider, activity, updatedAt, display, now, onOpen }, ref) {
  const status = updatedAt ? "Atualizado " + formatAge(updatedAt, now) : "Aguardando leitura";

  return (
    <aside ref={ref} className="provider-peek" onClick={onOpen} aria-label={provider.name}>
      <div className="provider-peek__head">
        <span className="provider-peek__brand">
          <ProviderIcon providerId={provider.id} size={18} brand />
          <span>
            <strong>{provider.name}</strong>
            <small>
              {status}
              {provider.plan ? " · " + provider.plan : ""}
            </small>
          </span>
        </span>
        <i className={"status-dot" + (provider.connected ? " status-dot--on" : "")} aria-hidden="true" />
      </div>

      {provider.error ? <div className="notice notice--error">{provider.error}</div> : null}

      {provider.windows.length ? (
        <div className="provider-peek__windows">
          {provider.windows.map((window) => (
            <QuotaWindowRow key={window.id} window={window} display={display} now={now} compact />
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
        Abrir no painel
      </button>
    </aside>
  );
});
