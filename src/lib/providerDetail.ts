import { lastDays } from "./costs.ts";
import type { HistoryPoint } from "./history.ts";
import type { CostEntry } from "../types";

export type DailyMetric = "cost" | "tokens" | "cache" | "peak";
export type DayValue = { date: string; value: number };
export type QuotaState = "healthy" | "warning" | "critical" | "depleted" | "unknown";

/** Which local cost log a provider's spending comes from. Antigravity accounts share one. */
export function costKeyFor(providerId: string): "claude" | "codex" | "antigravity" | null {
  if (providerId === "claude" || providerId === "codex") return providerId;
  if (providerId.startsWith("antigravity") && !providerId.startsWith("antigravity-openbot")) return "antigravity";
  return null;
}

/** One value per local day, oldest first, zeros included. */
export function dailyCosts(entries: CostEntry[], costKey: string, metric: Exclude<DailyMetric, "peak">, dayCount: number, today = new Date()): DayValue[] {
  const days = lastDays(dayCount, today);
  const totals = new Map(days.map((date) => [date, 0]));
  for (const entry of entries) {
    if (entry.provider !== costKey || !totals.has(entry.date)) continue;
    const value =
      metric === "cost"
        ? entry.costUsd ?? 0
        : metric === "cache"
          ? entry.cacheReadTokens
          : entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens + entry.cacheReadTokens;
    totals.set(entry.date, (totals.get(entry.date) ?? 0) + value);
  }
  return days.map((date) => ({ date, value: totals.get(date) ?? 0 }));
}

/** Spending and tokens of today, and how much of the input came from cache. */
export function todayTotals(entries: CostEntry[], costKey: string, today = new Date()) {
  const [date] = lastDays(1, today);
  let cost = 0;
  let tokens = 0;
  let cacheRead = 0;
  let priced = true;
  for (const entry of entries) {
    if (entry.provider !== costKey || entry.date !== date) continue;
    if (entry.costUsd == null) priced = false;
    cost += entry.costUsd ?? 0;
    tokens += entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens + entry.cacheReadTokens;
    cacheRead += entry.cacheReadTokens;
  }
  return { cost, tokens, priced, cacheShare: tokens > 0 ? Math.round((cacheRead / tokens) * 100) : 0 };
}

/** Highest percentage used on each day, from the saved readings (remaining → used). */
export function dailyPeakUsed(points: HistoryPoint[] | undefined, dayCount: number, today = new Date()): DayValue[] {
  const days = lastDays(dayCount, today);
  const peaks = new Map(days.map((date) => [date, 0]));
  for (const [time, remaining] of points ?? []) {
    const day = new Date(time);
    const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    if (!peaks.has(date)) continue;
    peaks.set(date, Math.max(peaks.get(date) ?? 0, 100 - Math.max(0, Math.min(100, remaining))));
  }
  return days.map((date) => ({ date, value: peaks.get(date) ?? 0 }));
}

/** The state badge of a quota window, from what is left. */
export function quotaState(remaining: number | null | undefined): QuotaState {
  if (remaining == null || Number.isNaN(remaining)) return "unknown";
  if (remaining <= 0) return "depleted";
  if (remaining <= 25) return "critical";
  if (remaining <= 60) return "warning";
  return "healthy";
}
