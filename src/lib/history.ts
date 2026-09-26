import type { ProviderUsage } from "../types";
import { readJson, writeJson } from "./storage";

const STORAGE_HISTORY = "ai-dock-usage-history";
const KEEP_MS = 24 * 60 * 60 * 1000;
const MIN_GAP_MS = 60 * 1000;

/** [timestamp, remaining percent] samples for one usage window. */
export type HistoryPoint = [number, number];
export type UsageHistory = Record<string, HistoryPoint[]>;

export function historyKey(providerId: string, windowId: string) {
  return providerId + ":" + windowId;
}

export function loadHistory(): UsageHistory {
  return readJson<UsageHistory>(STORAGE_HISTORY, {});
}

/** Adds one sample per window and drops anything older than 24 hours. */
export function recordHistory(history: UsageHistory, providers: ProviderUsage[], now = Date.now()) {
  const next: UsageHistory = {};
  for (const [key, points] of Object.entries(history)) {
    const kept = points.filter(([time]) => now - time <= KEEP_MS);
    if (kept.length) next[key] = kept;
  }
  for (const provider of providers) {
    if (!provider.connected) continue;
    for (const window of provider.windows) {
      const key = historyKey(provider.id, window.id);
      const points = next[key] || [];
      const last = points[points.length - 1];
      const value = Math.round(window.remainingPercent * 10) / 10;
      if (last && now - last[0] < MIN_GAP_MS) points[points.length - 1] = [now, value];
      else points.push([now, value]);
      next[key] = points;
    }
  }
  writeJson(STORAGE_HISTORY, next);
  return next;
}
