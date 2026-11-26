import { lastDays } from "./costs.ts";
import { readJson, writeJson } from "./storage.ts";
import type { CostEntry } from "../types";

const STORAGE_DAILY = "ai-dock-daily-costs";
/** A year and a week: enough for any map size, still a few kilobytes. */
const KEEP_DAYS = 371;

/** Spending and tokens of one tool on one day: [cost in USD, tokens]. */
export type DayTotals = [number, number];
/** date (YYYY-MM-DD) → tool → totals. */
export type DailyStore = Record<string, Record<string, DayTotals>>;

export type HeatCell = { date: string; cost: number; tokens: number; level: 0 | 1 | 2 | 3 | 4 };
export type HeatMonth = { column: number; date: string };
export type Heatmap = {
  /** Week columns, Sunday first; days after today are null. */
  weeks: (HeatCell | null)[][];
  months: HeatMonth[];
  activeDays: number;
  totalCost: number;
  totalTokens: number;
};

export function loadDailyCosts(): DailyStore {
  return readJson<DailyStore>(STORAGE_DAILY, {});
}

/**
 * Folds a cost report into the saved day totals. The logs only reach back a few
 * weeks (Claude Code deletes them after 30 days), so each day keeps the largest
 * total ever read for it: a day only grows while it is read, and a later read
 * can only miss lines whose files were deleted.
 */
export function mergeDailyCosts(store: DailyStore, entries: CostEntry[], today = new Date()): DailyStore {
  const fresh: DailyStore = {};
  for (const entry of entries) {
    const day = (fresh[entry.date] ??= {});
    const totals = (day[entry.provider] ??= [0, 0]);
    totals[0] += entry.costUsd ?? 0;
    totals[1] += entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens + entry.cacheReadTokens;
  }

  const keep = new Set(lastDays(KEEP_DAYS, today));
  const next: DailyStore = {};
  for (const [date, tools] of Object.entries(store)) {
    if (keep.has(date)) next[date] = { ...tools };
  }
  for (const [date, tools] of Object.entries(fresh)) {
    if (!keep.has(date)) continue;
    const day = (next[date] ??= {});
    for (const [tool, [cost, tokens]] of Object.entries(tools)) {
      const saved = day[tool] ?? [0, 0];
      day[tool] = [Math.round(Math.max(saved[0], cost) * 100) / 100, Math.max(saved[1], tokens)];
    }
  }
  return next;
}

export function recordDailyCosts(entries: CostEntry[], today = new Date()): DailyStore {
  const next = mergeDailyCosts(loadDailyCosts(), entries, today);
  writeJson(STORAGE_DAILY, next);
  return next;
}

/**
 * One cell per day for the last `weekCount` weeks, like GitHub's contribution
 * map. Levels split the active days in quarters by spending (tokens when nothing
 * has a price), so one heavy day does not wash out the rest.
 */
export function buildHeatmap(store: DailyStore, tool: string, weekCount: number, today = new Date()): Heatmap {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysShown = (weekCount - 1) * 7 + end.getDay() + 1;
  const dates = lastDays(daysShown, end);

  const cells: HeatCell[] = dates.map((date) => {
    let cost = 0;
    let tokens = 0;
    for (const [name, [dayCost, dayTokens]] of Object.entries(store[date] ?? {})) {
      if (tool !== "all" && name !== tool) continue;
      cost += dayCost;
      tokens += dayTokens;
    }
    return { date, cost, tokens, level: 0 };
  });

  const byCost = cells.some((cell) => cell.cost > 0);
  const measure = (cell: HeatCell) => (byCost ? cell.cost : cell.tokens);
  const active = cells.filter((cell) => measure(cell) > 0);
  const sorted = active.map(measure).sort((a, b) => a - b);
  for (const cell of active) {
    // Share of active days at or below this one, in quarters; the heaviest day is always 4.
    const rank = sorted.lastIndexOf(measure(cell)) + 1;
    cell.level = Math.max(1, Math.ceil((rank / sorted.length) * 4)) as HeatCell["level"];
  }

  const weeks: (HeatCell | null)[][] = [];
  for (let index = 0; index < weekCount * 7; index += 1) {
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push(cells[index] ?? null);
  }

  // A month label sits over the week holding its first day, if there is room.
  const months: HeatMonth[] = [];
  weeks.forEach((week, column) => {
    // The first column names its own month unless a new one starts inside it.
    const first = week.find((cell) => cell?.date.endsWith("-01")) ?? (column === 0 ? week[0] : undefined);
    if (!first) return;
    const previous = months[months.length - 1];
    if (previous && column - previous.column < 3) {
      if (previous.column === 0) months.pop();
      else return;
    }
    months.push({ column, date: first.date });
  });

  return {
    weeks,
    months,
    activeDays: active.length,
    totalCost: cells.reduce((sum, cell) => sum + cell.cost, 0),
    totalTokens: cells.reduce((sum, cell) => sum + cell.tokens, 0)
  };
}
