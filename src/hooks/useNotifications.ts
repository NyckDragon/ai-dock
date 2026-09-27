import {
  isPermissionGranted,
  requestPermission,
  sendNotification
} from "@tauri-apps/plugin-notification";
import { useEffect, useRef } from "react";
import { isTauri } from "../lib/tauri";
import type { ProviderActivity, ProviderUsage, Settings } from "../types";

const LOW_THRESHOLDS = [20, 5];
const RESET_JUMP = 30;

let permission: Promise<boolean> | null = null;

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

export async function notify(title: string, body: string) {
  if (!(await ensureNotificationPermission())) return;
  sendNotification({ title, body });
}

const ACTIVITY_NAMES: Record<string, string> = {
  codex: "Codex",
  cursor: "Cursor",
  antigravity: "Antigravity",
  claude: "Claude"
};

/**
 * Sends Windows notifications when a quota window crosses 20% or 5%, when it
 * resets, and when an agent stops to wait for you. The first reading only sets
 * the baseline, so opening the app never floods the notification center.
 */
export function useNotifications(
  providers: ProviderUsage[],
  activities: ProviderActivity[],
  settings: Settings
) {
  const quotaRef = useRef<Map<string, number> | null>(null);
  const activityRef = useRef<Map<string, string> | null>(null);
  const claudeExpiredRef = useRef<boolean | null>(null);

  // Only fires after the silent renewal already failed, so it really needs you.
  useEffect(() => {
    const claude = providers.find((provider) => provider.id === "claude");
    if (!claude) return;
    const expired = !claude.connected && /expirou/i.test(claude.error || "");
    if (expired && claudeExpiredRef.current === false) {
      void notify("A sessão do Claude expirou", "Abra o AI Dock e clique em Reconectar. Leva uns segundos.");
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
              provider.name + ": " + Math.round(now) + "% restante",
              window.label + (crossed === 5 ? " está quase no fim." : " passou de 80% de uso.")
            );
          }
        }
        if (settings.notifyReset && now - before >= RESET_JUMP) {
          void notify(provider.name + ": limite renovado", window.label + " voltou para " + Math.round(now) + "%.");
        }
      }
    }
    quotaRef.current = next;
  }, [providers, settings.notifyLowQuota, settings.notifyReset, settings.hiddenProviders]);

  useEffect(() => {
    const previous = activityRef.current;
    const next = new Map<string, string>();
    for (const activity of activities) {
      next.set(activity.providerId, activity.state);
      if (!previous || !settings.notifyWaiting) continue;
      if (activity.state === "waiting" && previous.get(activity.providerId) !== "waiting") {
        const session = activity.sessions.find((item) => item.state === "waiting") || activity.sessions[0];
        void notify(
          (ACTIVITY_NAMES[activity.providerId] || activity.providerId) + " está esperando você",
          session?.title || "Uma tarefa precisa da sua resposta."
        );
      }
    }
    activityRef.current = next;
  }, [activities, settings.notifyWaiting]);
}
