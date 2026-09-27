import { intlLocale, t } from "./i18n.ts";
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
  return new Intl.DateTimeFormat(intlLocale(), {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

/** Relative reset time, the same wording in the peek and in the panel. */
export function formatReset(resetAt: string | null | undefined, now: number) {
  if (!resetAt) return t("Sem reset informado");
  const date = new Date(resetAt);
  if (Number.isNaN(date.getTime())) return t("Reset {date}", { date: resetAt });
  const diff = date.getTime() - now;
  if (diff <= 0) return t("Reset pendente");
  if (diff < 7 * 24 * 60 * 60 * 1000) return t("Reseta em {time}", { time: formatDuration(diff) });
  return t("Reseta {date}", { date: absoluteDate(resetAt) || resetAt });
}

export function formatAge(since: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - since) / 60000);
  if (minutes < 1) return t("agora");
  if (minutes < 60) return t("há {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("há {hours}h {minutes}min", { hours, minutes: minutes % 60 });
  return t("há {days}d", { days: Math.floor(hours / 24) });
}

export function formatPace(pace: Pace | null) {
  if (!pace) return null;
  if (pace.runsOutIn === 0) return { text: t("Esgotado"), tone: "danger" as const };
  if (pace.runsOutIn != null) {
    const soon = pace.runsOutIn < 12 * 60 * 60 * 1000;
    return {
      text: t("Esgota em {time}", { time: formatDuration(pace.runsOutIn) }),
      tone: soon ? ("danger" as const) : ("warning" as const)
    };
  }
  const delta = Math.round(pace.delta);
  if (delta > 5) return { text: t("{value}% acima do ritmo", { value: delta }), tone: "warning" as const };
  if (delta < -5) return { text: t("{value}% abaixo do ritmo", { value: Math.abs(delta) }), tone: "good" as const };
  return { text: t("No ritmo"), tone: "good" as const };
}
