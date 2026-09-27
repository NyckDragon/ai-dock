import type { HeadlineWindow, PercentDisplay, ProviderUsage, Settings, UsageWindow } from "../types";

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
  return displayKind(display, providerId) === "used" ? "usado" : "restante";
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

/** Antigravity has two separate pools, so the compact dock gives each its own slot. */
export function compactSlots(providers: ProviderUsage[]): ProviderUsage[] {
  const slots: ProviderUsage[] = [];
  for (const provider of providers) {
    if (provider.id !== "antigravity") {
      slots.push(provider);
      continue;
    }
    const gemini = provider.windows.filter((item) => item.id.startsWith("gemini"));
    const other = provider.windows.filter(
      (item) => item.id.startsWith("claude-gpt") || item.id.startsWith("third-party")
    );
    slots.push({ ...provider, id: "antigravity-gemini", name: "Gemini", windows: gemini });
    slots.push({ ...provider, id: "antigravity-gpt", name: "Claude + GPT", windows: other });
  }
  return slots;
}

export function baseProviderId(slotId: string) {
  return slotId.startsWith("antigravity-") ? "antigravity" : slotId;
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
