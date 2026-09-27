import { formatAge } from "../lib/format";
import { t, tr } from "../lib/i18n";
import type { ProviderActivity } from "../types";

export function activityHeadline(activity: ProviderActivity) {
  const count = activity.sessions.length;
  const waiting = activity.sessions.filter((session) => session.state === "waiting").length;
  if (activity.state === "waiting") return waiting > 1 ? t("{count} esperando você", { count: waiting }) : t("Esperando você");
  return count > 1 ? t("{count} trabalhando", { count }) : t("Trabalhando");
}

export function ActivityBlock({
  activity,
  now,
  limit = 3
}: {
  activity: ProviderActivity | undefined;
  now: number;
  limit?: number;
}) {
  if (!activity || activity.state === "idle") return null;
  const hidden = activity.sessions.length - limit;

  return (
    <div className={"activity activity--" + activity.state}>
      <div className="activity__title">
        <i aria-hidden="true" />
        <strong>{activityHeadline(activity)}</strong>
        {activity.confidence === "inferred" ? (
          <small title={t("Inferido pela atividade recente dos arquivos locais")}>{t("estimado")}</small>
        ) : null}
      </div>
      {activity.sessions.slice(0, limit).map((session) => (
        <div className={"activity__session activity__session--" + session.state} key={session.id}>
          <span>
            <strong>{tr(session.title)}</strong>
            {session.detail ? <small>{tr(session.detail)}</small> : null}
          </span>
          <time>{formatAge(session.since, now)}</time>
        </div>
      ))}
      {hidden > 0 ? <div className="activity__more">{hidden === 1 ? t("+1 tarefa") : t("+{count} tarefas", { count: hidden })}</div> : null}
    </div>
  );
}
