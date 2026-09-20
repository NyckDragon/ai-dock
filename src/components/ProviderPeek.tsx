import type { ProviderActivity, ProviderUsage } from "../types";
import { ProviderIcon } from "./ProviderIcon";

function clamp(value: number) {
  return Math.max(0, Math.min(100, value));
}

function formatReset(resetAt?: string | null) {
  if (!resetAt) return "Sem reset informado";
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return "Reset " + resetAt;
  const diff = date.getTime() - Date.now();

  if (diff > 0 && diff < 7 * 24 * 60 * 60 * 1000) {
    const totalMinutes = Math.max(1, Math.round(diff / 60000));
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days) parts.push(days + "d");
    if (hours) parts.push(hours + "h");
    if (!days && minutes) parts.push(minutes + "min");
    return "Reseta em " + parts.join(" ");
  }

  return "Reset " + new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function age(since: number) {
  const diff = Math.max(0, Date.now() - since);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return "há " + minutes + " min";
  const hours = Math.floor(minutes / 60);
  return "há " + hours + "h " + (minutes % 60) + "min";
}

export function ProviderPeek({
  provider,
  activity,
  updatedAt
}: {
  provider: ProviderUsage;
  activity?: ProviderActivity;
  updatedAt: number | null;
}) {
  const showActivity = activity && activity.state !== "idle";
  const activityCount = activity?.sessions.length || 0;
  const waitingCount = activity?.sessions.filter((session) => session.state === "waiting").length || 0;
  const activityTitle = activity?.state === "waiting"
    ? waitingCount > 1
      ? waitingCount + " esperando você"
      : "Esperando você"
    : activityCount > 1
      ? activityCount + " trabalhando"
      : "Trabalhando";

  return (
    <aside className="provider-peek" role="status">
      <div className="provider-peek__head">
        <span className="provider-peek__brand">
          <ProviderIcon providerId={provider.id} size={18} title={provider.name} />
          <span>
            <strong>{provider.name}</strong>
            <small>
              {updatedAt ? "Atualizado agora" : "Aguardando leitura"}
              {provider.plan ? " · " + provider.plan : ""}
            </small>
          </span>
        </span>
        <i className={provider.connected ? "peek-status peek-status--on" : "peek-status"} />
      </div>

      {provider.error ? <div className="provider-peek__error">{provider.error}</div> : null}

      <div className="provider-peek__windows">
        {provider.windows.map((window) => {
          const percent = clamp(window.remainingPercent);
          return (
            <div className="provider-peek__window" key={window.id}>
              <div className="provider-peek__labels">
                <span>{window.label}</span>
                <strong>{Math.round(percent)}%</strong>
              </div>
              <div className="provider-peek__track">
                <i style={{ width: percent + "%" }} />
              </div>
              <small>{formatReset(window.resetAt)}</small>
            </div>
          );
        })}
      </div>

      {showActivity ? (
        <div className={"provider-peek__activity provider-peek__activity--" + activity.state}>
          <div className="provider-peek__activity-title">
            <i />
            <strong>{activityTitle}</strong>
            {activity.confidence === "inferred" ? <small>estimado</small> : null}
          </div>
          {activity.sessions.slice(0, 3).map((session) => (
            <div className="provider-peek__session" key={session.id}>
              <span>
                <strong>{session.title}</strong>
                <small>{session.detail}</small>
              </span>
              <time>{age(session.since)}</time>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
