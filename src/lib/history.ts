import type { HistoryRange, ProviderUsage } from "../types";
import { readJson, writeJson } from "./storage.ts";

const STORAGE_HISTORY = "ai-dock-usage-history";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const KEEP_MS = 30 * DAY_MS;
const MIN_GAP_MS = 60 * 1000;

/** [timestamp, remaining percent] samples for one usage window. */
export type HistoryPoint = [number, number];
export type UsageHistory = Record<string, HistoryPoint[]>;

export const RANGE_MS: Record<HistoryRange, number> = {
  "24h": DAY_MS,
  "7d": 7 * DAY_MS,
  "30d": 30 * DAY_MS
};

export function historyKey(providerId: string, windowId: string) {
  return providerId + ":" + windowId;
}

export function loadHistory(): UsageHistory {
  return readJson<UsageHistory>(STORAGE_HISTORY, {});
}

/**
 * Keeps every sample from the last 24 hours and one per hour before that (the
 * last one of each hour), so 30 days stay small in storage.
 */
export function compactPoints(points: HistoryPoint[], now: number): HistoryPoint[] {
  const recentFrom = now - DAY_MS;
  const byHour = new Map<number, HistoryPoint>();
  const recent: HistoryPoint[] = [];
  for (const point of points) {
    const [time] = point;
    if (now - time > KEEP_MS) continue;
    if (time >= recentFrom) recent.push(point);
    else byHour.set(Math.floor(time / HOUR_MS), point);
  }
  return [...[...byHour.values()].sort((a, b) => a[0] - b[0]), ...recent];
}

/** Adds one sample per window and compacts anything older than 24 hours. */
export function recordHistory(history: UsageHistory, providers: ProviderUsage[], now = Date.now()) {
  const next: UsageHistory = {};
  for (const [key, points] of Object.entries(history)) {
    const kept = compactPoints(points, now);
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

/** Samples inside the chosen range. */
export function pointsInRange(points: HistoryPoint[] | undefined, range: HistoryRange, now = Date.now()) {
  if (!points) return undefined;
  const from = now - RANGE_MS[range];
  return points.filter(([time]) => time >= from);
}
