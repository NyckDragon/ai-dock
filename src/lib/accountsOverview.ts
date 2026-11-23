import { wrongAccount } from "./accounts.ts";
import type { ProviderUsage } from "../types";

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
