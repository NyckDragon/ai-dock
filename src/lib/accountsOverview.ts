import { wrongAccount } from "./accounts.ts";
import type { ProviderActivity, ProviderUsage } from "../types";

export type SessionPool = { id: string; label: string; remaining: number; color: string };

const POOLS = [
  { prefix: "gemini", label: "Gemini", color: "#38bdf8" },
  { prefix: "claude-gpt", label: "Claude", color: "#c084fc" },
  { prefix: "third-party", label: "Claude", color: "#c084fc" }
];

/** The 5h session of each model pool an Antigravity account reports. */
export function sessionPools(account: ProviderUsage): SessionPool[] {
  const pools: SessionPool[] = [];
  for (const pool of POOLS) {
    if (pools.some((item) => item.label === pool.label)) continue;
    const window = account.windows.find((w) => w.id.startsWith(pool.prefix) && /session|5h/i.test(w.id));
    if (window) {
      pools.push({
        id: window.id,
        label: pool.label,
        remaining: Math.round(Math.max(0, Math.min(100, window.remainingPercent))),
        color: pool.color
      });
    }
  }
  return pools;
}

/**
 * The account with the most room right now: the best of its tightest session
 * pool. A window signed in with the wrong account, or one not running, is skipped.
 */
export function bestAccount(accounts: ProviderUsage[]): ProviderUsage | null {
  let best: ProviderUsage | null = null;
  let bestScore = -1;
  for (const account of accounts) {
    if (!account.connected || account.stale || wrongAccount(account)) continue;
    const pools = sessionPools(account);
    if (!pools.length) continue;
    const score = Math.min(...pools.map((pool) => pool.remaining));
    if (score > bestScore) {
      best = account;
      bestScore = score;
    }
  }
  return best;
}

/** Antigravity accounts of the app itself (OpenBot slots are not accounts). */
export function antigravityAccounts(providers: ProviderUsage[]): ProviderUsage[] {
  return providers.filter((provider) => provider.id.startsWith("antigravity") && !provider.id.startsWith("antigravity-openbot"));
}

/** Room left at which the account in use is worth leaving, and room the next one needs. */
export const SWITCH_BELOW = 15;
export const SWITCH_TARGET_MIN = 50;

export type SwitchSuggestion = {
  from: ProviderUsage;
  to: ProviderUsage;
  /** "Gemini" or "Claude" (the Claude + GPT pool). */
  pool: string;
  fromRemaining: number;
  toRemaining: number;
};

const POOL_LABEL: Record<string, string> = { gemini: "Gemini", "claude-gpt": "Claude" };

/**
 * Our own idea: the Antigravity account an agent is working in is nearly out
 * in the model it uses, and another account has plenty of that model left.
 * Suggests moving there. Null when nothing needs to change.
 */
export function switchSuggestion(accounts: ProviderUsage[], activities: ProviderActivity[]): SwitchSuggestion | null {
  const live = accounts.filter((account) => account.connected && !account.stale && !wrongAccount(account));
  let best: SwitchSuggestion | null = null;
  for (const account of live) {
    const activity = activities.find((item) => item.providerId === account.id);
    if (!activity || activity.state === "idle") continue;
    const pools = sessionPools(account);
    const usedPools = new Set(activity.sessions.map((session) => session.pool).filter(Boolean).map((pool) => POOL_LABEL[pool as string]));
    // Unknown model: the tightest pool is the one that runs out first.
    const watched = usedPools.size ? pools.filter((pool) => usedPools.has(pool.label)) : pools;
    for (const pool of watched) {
      if (pool.remaining > SWITCH_BELOW) continue;
      for (const other of live) {
        if (other.id === account.id) continue;
        const room = sessionPools(other).find((item) => item.label === pool.label)?.remaining ?? 0;
        if (room < SWITCH_TARGET_MIN) continue;
        if (!best || room > best.toRemaining) {
          best = { from: account, to: other, pool: pool.label, fromRemaining: pool.remaining, toRemaining: room };
        }
      }
    }
  }
  return best;
}
