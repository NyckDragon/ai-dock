import { formatAge } from "../lib/format";
import type { ProviderActivity } from "../types";

export function activityHeadline(activity: ProviderActivity) {
  const count = activity.sessions.length;
  const waiting = activity.sessions.filter((session) => session.state === "waiting").length;
  if (activity.state === "waiting") return waiting > 1 ? waiting + " esperando você" : "Esperando você";
  return count > 1 ? count + " trabalhando" : "Trabalhando";
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
          <small title="Inferido pela atividade recente dos arquivos locais">estimado</small>
        ) : null}
      </div>
      {activity.sessions.slice(0, limit).map((session) => (
        <div className={"activity__session activity__session--" + session.state} key={session.id}>
          <span>
            <strong>{session.title}</strong>
            {session.detail ? <small>{session.detail}</small> : null}
          </span>
          <time>{formatAge(session.since, now)}</time>
        </div>
      ))}
      {hidden > 0 ? <div className="activity__more">+{hidden} {hidden === 1 ? "tarefa" : "tarefas"}</div> : null}
    </div>
  );
}
