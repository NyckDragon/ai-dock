import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import { t } from "../lib/i18n";
import { isTauri } from "../lib/tauri";
import type { ProviderActivity, ProviderStatus, ProviderUsage, Settings } from "../types";

const LOW_THRESHOLDS = [20, 5];
const RESET_JUMP = 30;
/** Failed refreshes in a row before a provider counts as broken. */
const FAILURES_BEFORE_ALERT = 3;

let permission: Promise<boolean> | null = null;
let pausedUntil: number | null = null;

export async function ensureNotificationPermission() {
  if (!isTauri()) return false;
  if (!permission) {
    permission = (async () => {
      if (await isPermissionGranted()) return true;
      return (await requestPermission()) === "granted";
    })().catch(() => false);
  }
  const granted = await permission;
  if (!granted) permission = null;
  return granted;
}

/** Silences every notification until the given time (epoch ms), or resumes with null. */
export function setNotificationPause(until: number | null) {
  pausedUntil = until;
}

export function notificationsPaused(now = Date.now()) {
  return pausedUntil != null && pausedUntil > now;
}

/** Sends a notification unless they are paused. `force` is for the test button. */
export async function notify(title: string, body: string, force = false) {
  if (!force && notificationsPaused()) return;
  if (!(await ensureNotificationPermission())) return;
  sendNotification({ title, body });
}

const NAMES: Record<string, string> = {
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
  claude: "Claude"
};

const LEVEL_RANK: Record<string, number> = { none: 0, maintenance: 1, minor: 2, major: 3, critical: 4 };

/**
 * Sends Windows notifications when a quota window crosses 20% or 5%, when it
 * resets, when an agent stops to wait for you, when a provider's service has an
 * incident, and when a provider keeps failing to refresh (and when it recovers).
 * The first reading only sets the baseline, so opening the app never floods the
 * notification center.
 */
export function useNotifications(
  providers: ProviderUsage[],
  activities: ProviderActivity[],
  statuses: ProviderStatus[],
  settings: Settings
) {
  const quotaRef = useRef<Map<string, number> | null>(null);
  const activityRef = useRef<Map<string, string> | null>(null);
  const claudeExpiredRef = useRef<boolean | null>(null);
  const statusRef = useRef<Map<string, number> | null>(null);
  const failuresRef = useRef(new Map<string, { count: number; alerted: boolean; seen: number }>());

  useEffect(() => {
    setNotificationPause(settings.notificationsPausedUntil);
  }, [settings.notificationsPausedUntil]);

  // Only fires after the silent renewal already failed, so it really needs you.
  useEffect(() => {
    const claude = providers.find((provider) => provider.id === "claude");
    if (!claude) return;
    const expired = !claude.connected && /expirou/i.test(claude.error || "");
    if (expired && claudeExpiredRef.current === false) {
      void notify(t("A sessão do Claude expirou"), t("Abra o AI Dock e clique em Reconectar. Leva uns segundos."));
    }
    claudeExpiredRef.current = expired;
  }, [providers]);

  useEffect(() => {
    if (!providers.length) return;
    const previous = quotaRef.current;
    const next = new Map<string, number>();

    for (const provider of providers) {
      if (!provider.connected || settings.hiddenProviders.includes(provider.id)) continue;
      for (const window of provider.windows) {
        const key = provider.id + ":" + window.id;
        const now = window.remainingPercent;
        next.set(key, now);
        const before = previous?.get(key);
        if (before == null) continue;

        if (settings.notifyLowQuota) {
          const crossed = LOW_THRESHOLDS.find((limit) => before > limit && now <= limit);
          if (crossed != null) {
            void notify(
              t("{name}: {value}% restante", { name: provider.name, value: Math.round(now) }),
              crossed === 5
                ? t("{window} está quase no fim.", { window: window.label })
                : t("{window} passou de 80% de uso.", { window: window.label })
            );
          }
        }
        if (settings.notifyReset && now - before >= RESET_JUMP) {
          void notify(
            t("{name}: limite renovado", { name: provider.name }),
            t("{window} voltou para {value}%.", { window: window.label, value: Math.round(now) })
          );
        }
      }
    }
    quotaRef.current = next;
  }, [providers, settings.notifyLowQuota, settings.notifyReset, settings.hiddenProviders]);

  // A provider that keeps failing (its bars are the last good reading) and its recovery.
  useEffect(() => {
    const failures = failuresRef.current;
    for (const provider of providers) {
      if (settings.hiddenProviders.includes(provider.id)) continue;
      const entry = failures.get(provider.id) || { count: 0, alerted: false, seen: 0 };
      // Each refresh produces a new lastErrorAt/updatedAt; only count a new one once.
      const stamp = provider.stale ? provider.lastErrorAt || 0 : provider.updatedAt || 0;
      if (stamp === entry.seen) continue;
      entry.seen = stamp;
      // The Claude session has its own notification.
      const expired = /expirou/i.test(provider.error || "");
      if (provider.stale && !expired) {
        entry.count += 1;
        if (entry.count >= FAILURES_BEFORE_ALERT && !entry.alerted && settings.notifyFailures) {
          entry.alerted = true;
          void notify(
            t("{name} não está atualizando", { name: NAMES[provider.id] || provider.name }),
            t("O dock mostra a última leitura boa. Vou avisar quando voltar.")
          );
        }
      } else if (!provider.stale && provider.connected) {
        if (entry.alerted && settings.notifyFailures) {
          void notify(t("{name} voltou a atualizar", { name: NAMES[provider.id] || provider.name }), t("Os números estão em dia de novo."));
        }
        entry.count = 0;
        entry.alerted = false;
      }
      failures.set(provider.id, entry);
    }
  }, [providers, settings.notifyFailures, settings.hiddenProviders]);

  useEffect(() => {
    const previous = activityRef.current;
    const next = new Map<string, string>();
    for (const activity of activities) {
      next.set(activity.providerId, activity.state);
      if (!previous || !settings.notifyWaiting) continue;
      if (activity.state === "waiting" && previous.get(activity.providerId) !== "waiting") {
        const session = activity.sessions.find((item) => item.state === "waiting") || activity.sessions[0];
        void notify(
          t("{name} está esperando você", { name: NAMES[activity.providerId] || activity.providerId }),
          session?.title || t("Uma tarefa precisa da sua resposta.")
        );
      }
    }
    activityRef.current = next;
  }, [activities, settings.notifyWaiting]);

  // A new or worse incident on a provider's official status page.
  useEffect(() => {
    if (!statuses.length) return;
    const previous = statusRef.current;
    const next = new Map<string, number>();
    for (const status of statuses) {
      const rank = LEVEL_RANK[status.level] ?? 0;
      next.set(status.providerId, rank);
      if (!previous || !settings.notifyIncidents || settings.hiddenProviders.includes(status.providerId)) continue;
      // Maintenance alone is not worth a notification.
      if (rank >= 2 && rank > (previous.get(status.providerId) ?? 0)) {
        void notify(
          t("{name} com instabilidade", { name: NAMES[status.providerId] || status.providerId }),
          status.summary || t("Veja a página de status para detalhes.")
        );
      }
    }
    statusRef.current = next;
  }, [statuses, settings.notifyIncidents, settings.hiddenProviders]);
}
