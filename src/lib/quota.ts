import type { AntigravityGroupMode, HeadlineWindow, PercentDisplay, ProviderActivity, ProviderUsage, Settings, UsageWindow } from "../types";
import { t } from "./i18n.ts";

export type QuotaTone = "good" | "warning" | "danger" | "empty";

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

/** The window closest to running out, which is the one that actually limits you. Stale readings count. */
export function limitingWindow(provider: ProviderUsage): UsageWindow | null {
  if (provider.windows.length === 0) return null;
  return provider.windows.reduce((lowest, item) =>
    item.remainingPercent < lowest.remainingPercent ? item : lowest
  );
}

/** The current short window (5h session), for providers that have one. */
export function sessionWindow(provider: ProviderUsage): UsageWindow | null {
  return provider.windows.find((window) => /session|5h/i.test(window.id)) || null;
}

/**
 * The window the dock features: the current session by default, falling back to
 * the most limiting one when a provider has no session window (Cursor, for one).
 */
export function featuredWindow(provider: ProviderUsage, headline: HeadlineWindow): UsageWindow | null {
  if (headline === "session") return sessionWindow(provider) || limitingWindow(provider);
  return limitingWindow(provider);
}

export function providerHeadroom(provider: ProviderUsage, headline: HeadlineWindow = "limiting") {
  const window = featuredWindow(provider, headline);
  return window ? clampPercent(window.remainingPercent) : null;
}

export function quotaTone(remaining: number | null): QuotaTone {
  if (remaining == null) return "empty";
  if (remaining > 60) return "good";
  if (remaining > 25) return "warning";
  return "danger";
}

/** Whether a provider shows consumed or remaining quota under the chosen display. */
export function displayKind(display: PercentDisplay, providerId: string): "used" | "remaining" {
  if (display !== "native") return display;
  // claude.ai reports utilization, so Claude reads "% usado" like on the site.
  return baseProviderId(providerId) === "claude" ? "used" : "remaining";
}

/** Turns a remaining percentage into what the user chose to see for this provider. */
export function shownPercent(remaining: number, display: PercentDisplay, providerId: string) {
  const value = clampPercent(remaining);
  return Math.round(displayKind(display, providerId) === "used" ? 100 - value : value);
}

export function displayWord(display: PercentDisplay, providerId: string) {
  return displayKind(display, providerId) === "used" ? t("usado") : t("restante");
}

export function percentLabel(remaining: number | null, display: PercentDisplay, providerId: string, showSign = true) {
  if (remaining == null) return "--";
  const value = shownPercent(remaining, display, providerId);
  return showSign ? value + "%" : String(value);
}

/** Orders and filters providers following the user's list in Settings. */
export function arrangeProviders(providers: ProviderUsage[], settings: Settings) {
  const rank = (id: string) => {
    const index = settings.providerOrder.indexOf(id);
    return index === -1 ? settings.providerOrder.length : index;
  };
  return providers
    .filter((provider) => !settings.hiddenProviders.includes(provider.id))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

/** Antigravity has separate pools, so the compact dock can fuse them into concentric rings/bars or give each its own slot. */
export function compactSlots(providers: ProviderUsage[], groupMode: AntigravityGroupMode = "bars"): ProviderUsage[] {
  const slots: ProviderUsage[] = [];
  for (const provider of providers) {
    if (!provider.id.startsWith("antigravity")) {
      slots.push(provider);
      continue;
    }
    if (groupMode !== "split") {
      slots.push(provider);
      continue;
    }
    const gemini = provider.windows.filter((item) => item.id.startsWith("gemini"));
    const other = provider.windows.filter(
      (item) => item.id.startsWith("claude-gpt") || item.id.startsWith("third-party")
    );
    const argon = provider.windows.filter((item) => item.id.startsWith("argon"));

    // "Antigravity · Conta 2" (or an alias) tells the accounts apart when there is more than one.
    const account = provider.name.replace(/^Antigravity( · )?/, "");
    const tag = account ? ` · ${account}` : "";
    const prefix = provider.id;

    if (gemini.length > 0) {
      slots.push({ ...provider, id: `${prefix}-gemini`, name: `Gemini${tag}`, windows: gemini });
    }
    if (other.length > 0) {
      slots.push({ ...provider, id: `${prefix}-gpt`, name: `Claude + GPT${tag}`, windows: other });
    }
    if (argon.length > 0) {
      slots.push({ ...provider, id: `${prefix}-argon`, name: `Argon${tag}`, windows: argon });
    }
  }
  return slots;
}

export type PoolRing = {
  id: string;
  name: string;
  remainingPercent: number;
  tone: QuotaTone;
  color: string;
  trackColor?: string;
};

export function antigravityPools(
  provider: ProviderUsage,
  headline: HeadlineWindow = "limiting",
  display: PercentDisplay = "native"
): PoolRing[] {
  const findPool = (prefix: string) => {
    const matching = provider.windows.filter((w) => w.id.startsWith(prefix));
    if (matching.length === 0) return null;
    if (headline === "session") {
      const session = matching.find((w) => /session|5h/i.test(w.id));
      if (session) return session;
    }
    return matching.reduce((lowest, item) => (item.remainingPercent < lowest.remainingPercent ? item : lowest));
  };

  const gemini = findPool("gemini");
  const claudeGpt = findPool("claude-gpt") || findPool("third-party");
  const argon = findPool("argon");

  const pools: PoolRing[] = [];

  const resolveColor = (remaining: number, healthyColor: string): { tone: QuotaTone; color: string } => {
    const tone = quotaTone(remaining);
    if (tone === "danger") return { tone, color: "var(--danger)" };
    if (tone === "warning") return { tone, color: "var(--warning)" };
    if (tone === "empty") return { tone, color: "var(--text-3)" };
    return { tone, color: healthyColor };
  };

  if (gemini) {
    const rem = clampPercent(gemini.remainingPercent);
    const val = shownPercent(rem, display, provider.id);
    const { tone, color } = resolveColor(rem, "#38bdf8");
    pools.push({
      id: "gemini",
      name: "Gemini",
      remainingPercent: val,
      tone,
      color,
      trackColor: "rgba(56, 189, 248, 0.15)"
    });
  }

  if (claudeGpt) {
    const rem = clampPercent(claudeGpt.remainingPercent);
    const val = shownPercent(rem, display, provider.id);
    const { tone, color } = resolveColor(rem, "#c084fc");
    pools.push({
      id: "claude-gpt",
      name: "Claude + GPT",
      remainingPercent: val,
      tone,
      color,
      trackColor: "rgba(192, 132, 252, 0.15)"
    });
  }

  if (argon) {
    const rem = clampPercent(argon.remainingPercent);
    const val = shownPercent(rem, display, provider.id);
    const { tone, color } = resolveColor(rem, "#34d399");
    pools.push({
      id: "argon",
      name: "Argon",
      remainingPercent: val,
      tone,
      color,
      trackColor: "rgba(52, 211, 153, 0.15)"
    });
  }

  return pools;
}

export function baseProviderId(slotId: string) {
  return slotId.startsWith("antigravity") ? "antigravity" : slotId;
}

const SLOT_POOL: Record<string, string> = { gemini: "gemini", gpt: "claude-gpt", argon: "argon" };
const POOL_SLOT = /^(antigravity(?:-\d+)?)-(gemini|gpt|argon)$/;

/** The provider id a dock slot belongs to: "antigravity-2-gemini" belongs to account "antigravity-2". */
export function accountId(slotId: string) {
  return slotId.match(POOL_SLOT)?.[1] ?? slotId;
}

/** Activity of the slot's own account. An Antigravity pool slot shows only the sessions
 * of its own quota pool; a session with no known pool shows on every pool. */
export function activityForSlot(activities: ProviderActivity[], slotId: string): ProviderActivity | undefined {
  const activity = activities.find((item) => item.providerId === accountId(slotId));
  const suffix = slotId.match(POOL_SLOT)?.[2];
  const pool = suffix ? SLOT_POOL[suffix] : undefined;
  if (!activity || !pool) return activity;
  const sessions = activity.sessions.filter((session) => !session.pool || session.pool === pool);
  if (sessions.length === activity.sessions.length) return activity;
  if (!sessions.length) return undefined;
  return { ...activity, sessions, state: sessions.some((session) => session.state === "waiting") ? "waiting" : "working" };
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Start of the window, when its length can be told from its id. */
function windowStart(window: UsageWindow, reset: Date): number | null {
  const id = window.id.toLowerCase();
  if (id.includes("week")) return reset.getTime() - 7 * DAY;
  if (id.includes("session") || id.includes("5h")) return reset.getTime() - 5 * HOUR;
  if (id === "included" || id === "api" || id === "on-demand") {
    // Cursor bills monthly; the cycle started one calendar month before it ends.
    const start = new Date(reset);
    start.setMonth(start.getMonth() - 1);
    return start.getTime();
  }
  return null;
}

export type Pace = {
  /** Used percentage points above (+) or below (-) a steady pace. */
  delta: number;
  /** Milliseconds until the window runs out at the current pace, when that happens before the reset. */
  runsOutIn: number | null;
};

/**
 * Compares usage with a steady pace through the window, like CodexBar does.
 * Returns null when the window length is unknown or too little of it has passed.
 */
export function windowPace(window: UsageWindow, now = Date.now()): Pace | null {
  if (!window.resetAt) return null;
  const reset = new Date(window.resetAt);
  if (Number.isNaN(reset.getTime()) || reset.getTime() <= now) return null;
  const start = windowStart(window, reset);
  if (start == null) return null;

  const duration = reset.getTime() - start;
  const elapsed = Math.min(duration, Math.max(0, now - start));
  if (elapsed < duration * 0.05) return null;

  const used = 100 - clampPercent(window.remainingPercent);
  const expected = (elapsed / duration) * 100;
  let runsOutIn: number | null = null;
  if (used > 0 && used < 100) {
    const perMs = used / elapsed;
    const left = (100 - used) / perMs;
    if (now + left < reset.getTime()) runsOutIn = left;
  } else if (used >= 100) {
    runsOutIn = 0;
  }
  return { delta: used - expected, runsOutIn };
}
