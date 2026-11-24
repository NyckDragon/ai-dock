import type { ProviderActivity, ProviderUsage, UsageWindow } from "../types";

/** The one dock entry that stands for everything inside OpenBot. */
export const OPENBOT_ID = "antigravity-openbot";

export type OpenBotOverview = { slots: string[]; runtimes: string[] };

/** A slot the backend opened only for an OpenBot account (no Antigravity window shows it). */
export function isOpenBotSlot(id: string) {
  return id.startsWith(OPENBOT_ID);
}

/** Each window id keeps the account with the most room left, preferring fresh readings. */
function bestWindows(accounts: ProviderUsage[]): UsageWindow[] {
  const live = accounts.filter((account) => account.connected && !account.stale);
  const pool = live.length ? live : accounts;
  const best = new Map<string, UsageWindow>();
  for (const account of pool) {
    for (const window of account.windows) {
      const current = best.get(window.id);
      if (!current || (!window.amount && window.remainingPercent > current.remainingPercent)) best.set(window.id, window);
    }
  }
  return [...best.values()];
}

/**
 * Folds every OpenBot account into one "OpenBot" entry, placed where the first
 * one was. Its windows show the most room any OpenBot account has; `members`
 * lists all accounts OpenBot uses, including the ones an Antigravity window
 * also shows (those keep their own entry too).
 */
export function mergeOpenBot(providers: ProviderUsage[], overview: OpenBotOverview | null): ProviderUsage[] {
  const own = providers.filter((provider) => isOpenBotSlot(provider.id));
  if (!own.length) return providers;
  const shared = providers.filter((provider) => !isOpenBotSlot(provider.id) && overview?.slots.includes(provider.id));
  const first = own[0];
  const merged: ProviderUsage = {
    ...first,
    id: OPENBOT_ID,
    name: "OpenBot",
    email: null,
    expectedEmail: undefined,
    connected: own.some((account) => account.connected),
    stale: own.every((account) => account.stale) || undefined,
    updatedAt: Math.max(0, ...own.map((account) => account.updatedAt ?? 0)) || first.updatedAt,
    error: own.some((account) => account.connected) ? null : first.error,
    windows: bestWindows(own),
    members: [...own, ...shared]
  };
  const result: ProviderUsage[] = [];
  for (const provider of providers) {
    if (provider.id === first.id) result.push(merged);
    else if (!isOpenBotSlot(provider.id)) result.push(provider);
  }
  return result;
}

/** Work from any OpenBot account lights the one OpenBot entry. */
export function mergeOpenBotActivity(activities: ProviderActivity[]): ProviderActivity[] {
  const own = activities.filter((activity) => isOpenBotSlot(activity.providerId));
  if (own.length < 2 && own.every((activity) => activity.providerId === OPENBOT_ID)) return activities;
  const sessions = own.flatMap((activity) => activity.sessions);
  const state = own.some((activity) => activity.state === "waiting")
    ? "waiting"
    : own.some((activity) => activity.state === "working")
      ? "working"
      : own[0].state;
  const merged: ProviderActivity = { ...own[0], providerId: OPENBOT_ID, state, sessions };
  return [...activities.filter((activity) => !isOpenBotSlot(activity.providerId)), merged];
}

/** Runtime folder name → the dock provider that reads the same AI, when there is one. */
const RUNTIME_PROVIDER: Record<string, string> = { claude: "claude", grok: "grok", codex: "codex", cursor: "cursor", deepseek: "deepseek" };
const RUNTIME_NAMES: Record<string, string> = { claude: "Claude", grok: "Grok", opencode: "OpenCode", codex: "Codex", cursor: "Cursor", deepseek: "DeepSeek" };

export function runtimeInfo(runtime: string) {
  return {
    name: RUNTIME_NAMES[runtime] ?? runtime.charAt(0).toUpperCase() + runtime.slice(1),
    providerId: RUNTIME_PROVIDER[runtime] ?? null
  };
}
