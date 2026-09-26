import type { Pace } from "./quota";

export function formatDuration(ms: number) {
  const totalMinutes = Math.max(1, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days) parts.push(days + "d");
  if (hours) parts.push(hours + "h");
  if (!days && minutes) parts.push(minutes + "min");
  return parts.join(" ");
}

export function absoluteDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/** Relative reset time, the same wording in the peek and in the panel. */
export function formatReset(resetAt: string | null | undefined, now: number) {
  if (!resetAt) return "Sem reset informado";
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return "Reset " + resetAt;
  const diff = date.getTime() - now;
  if (diff <= 0) return "Reset pendente";
  if (diff < 7 * 24 * 60 * 60 * 1000) return "Reseta em " + formatDuration(diff);
  return "Reseta " + absoluteDate(resetAt);
}

export function formatAge(since: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - since) / 60000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return "há " + minutes + " min";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return "há " + hours + "h " + (minutes % 60) + "min";
  return "há " + Math.floor(hours / 24) + "d";
}

export function formatPace(pace: Pace | null) {
  if (!pace) return null;
  if (pace.runsOutIn === 0) return { text: "Esgotado", tone: "danger" as const };
  if (pace.runsOutIn != null) {
    const soon = pace.runsOutIn < 12 * 60 * 60 * 1000;
    return {
      text: "Esgota em " + formatDuration(pace.runsOutIn),
      tone: soon ? ("danger" as const) : ("warning" as const)
    };
  }
  const delta = Math.round(pace.delta);
  if (delta > 5) return { text: delta + "% acima do ritmo", tone: "warning" as const };
  if (delta < -5) return { text: Math.abs(delta) + "% abaixo do ritmo", tone: "good" as const };
  return { text: "No ritmo", tone: "good" as const };
}
