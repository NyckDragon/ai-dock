import { AlertCircle, CheckCircle2 } from "lucide-react";
import type { ProviderActivity, ProviderUsage } from "../types";
import { ProviderIcon } from "./ProviderIcon";

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatReset(resetAt?: string | null) {
  if (!resetAt) return null;
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function UsageCard({
  provider,
  activity
}: {
  provider: ProviderUsage;
  activity?: ProviderActivity;
}) {
  const activityVisible = activity && activity.state !== "idle";

  return (
    <article className="usage-card">
      <div className="usage-card__top">
        <div>
          <div className="usage-provider-title">
            <ProviderIcon providerId={provider.id} size={15} title={provider.name} />
            <div className="provider-name">{provider.name}</div>
          </div>
          <div className="provider-meta">
            {provider.connected ? (
              <><CheckCircle2 size={12} /> Conectado{provider.plan ? " · " + provider.plan : ""}</>
            ) : (
              <><AlertCircle size={12} /> Não conectado</>
            )}
          </div>
        </div>
        <div className={"provider-dot provider-dot--" + provider.id} />
      </div>

      {provider.error ? <div className="usage-error">{provider.error}</div> : null}

      <div className="usage-windows">
        {provider.windows.map((window) => {
          const percent = clamp(window.remainingPercent);
          return (
            <div className="usage-window" key={window.id}>
              <div className="usage-window__labels">
                <span>{window.label}</span>
                <strong>{Math.round(percent)}% restante</strong>
              </div>
              <div className="usage-track" title={Math.round(percent) + "% restante"}>
                <div className="usage-fill" style={{ width: percent + "%" }} />
              </div>
              {formatReset(window.resetAt) ? (
                <div className="usage-reset">Reset {formatReset(window.resetAt)}</div>
              ) : null}
            </div>
          );
        })}
      </div>

      {activityVisible ? (
        <div className={"usage-activity usage-activity--" + activity.state}>
          <i />
          <span>
            {activity.state === "waiting" ? "Esperando você" : "Trabalhando"}
            {activity.sessions[0]?.title ? " · " + activity.sessions[0].title : ""}
          </span>
        </div>
      ) : null}
    </article>
  );
}
