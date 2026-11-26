import type { ActivitySession, ProviderActivity, ProviderUsage, UsageWindow } from "../types";

/** The one dock entry that stands for everything inside OpenBot. */
export const OPENBOT_ID = "antigravity-openbot";

/** One OpenBot bot: each has its own job, model and account. */
export type OpenBotBot = {
  name: string;
  /** Engine it runs on: "antigravity", "grok", ... */
  provider: string;
  model: string;
  /** Dock slot of its Antigravity account, when known. */
  account: string | null;
  /** OpenBot's folder id of that account. */
  accountId: string | null;
  /** Avatar color in OpenBot, 0–360. */
  hue: number;
  running: boolean;
  /** ISO start of the turn it runs now. */
  since: string | null;
};
/** One account folder of OpenBot (no id: the shared folder) and its dock slot. */
export type OpenBotAccount = { id: string | null; slot: string | null };
export type OpenBotOverview = {
  slots: string[];
  runtimes: string[];
  accounts?: OpenBotAccount[];
  bots?: OpenBotBot[];
};

/** "KRZ · Operador Flow 2K" → tag "KRZ", label "Operador Flow 2K". Names without a short code keep their initials. */
export function botName(name: string) {
  const match = /^([\p{L}\d]{1,4})\s*[·•\-|:]\s*(.+)$/u.exec(name.trim());
  if (match) return { tag: match[1].toUpperCase(), label: match[2] };
  const initials = name
    .trim()
    .split(/\s+/)
    .map((word) => word[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return { tag: initials || "?", label: name.trim() };
}

/** "gemini-4-hydrogen" → "Gemini 4 Hydrogen". */
export function modelLabel(model: string) {
  return model
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => (/^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

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

/**
 * Work from any OpenBot account lights the one OpenBot entry, and so does a bot
 * running on another engine (Grok, Claude). Antigravity bots already show
 * through their account's own activity, so they are not added twice.
 */
export function mergeOpenBotActivity(activities: ProviderActivity[], bots: OpenBotBot[] = []): ProviderActivity[] {
  const own = activities.filter((activity) => isOpenBotSlot(activity.providerId));
  const extra: ActivitySession[] = bots
    .filter((bot) => bot.running && bot.provider !== "antigravity")
    .map((bot) => ({
      id: "openbot-bot-" + bot.name,
      title: bot.name,
      detail: runtimeInfo(bot.provider).name + (bot.model ? " · " + modelLabel(bot.model) : ""),
      state: "working",
      since: (bot.since && Date.parse(bot.since)) || Date.now()
    }));
  if (!extra.length && own.length < 2 && own.every((activity) => activity.providerId === OPENBOT_ID)) return activities;
  if (!own.length) {
    return [...activities, { providerId: OPENBOT_ID, state: "working", confidence: "direct", sessions: extra }];
  }
  const sessions = [...own.flatMap((activity) => activity.sessions), ...extra];
  const state = own.some((activity) => activity.state === "waiting")
    ? "waiting"
    : extra.length || own.some((activity) => activity.state === "working")
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
