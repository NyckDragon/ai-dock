import type { CostEntry } from "../types";

export type CostTotals = {
  /** Sum of the entries that have a price. */
  cost: number;
  tokens: number;
  /** True when some tokens come from models without a price. */
  partial: boolean;
};

export type CostGroup = CostTotals & { key: string };
export type CostDay = CostTotals & { date: string };

export type CostSummary = {
  total: CostTotals;
  days: CostDay[];
  providers: CostGroup[];
  models: CostGroup[];
  projects: CostGroup[];
};

function tokensOf(entry: CostEntry) {
  return entry.inputTokens + entry.outputTokens + entry.cacheWriteTokens + entry.cacheReadTokens;
}

function empty(): CostTotals {
  return { cost: 0, tokens: 0, partial: false };
}

function add(target: CostTotals, entry: CostEntry) {
  target.tokens += tokensOf(entry);
  if (entry.costUsd == null) target.partial = true;
  else target.cost += entry.costUsd;
}

/** Local calendar days, oldest first, ending today: ["2026-09-21", …, "2026-09-27"]. */
export function lastDays(count: number, today = new Date()): string[] {
  const days: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    const month = String(day.getMonth() + 1).padStart(2, "0");
    const date = String(day.getDate()).padStart(2, "0");
    days.push(`${day.getFullYear()}-${month}-${date}`);
  }
  return days;
}

function grouped(entries: CostEntry[], keyOf: (entry: CostEntry) => string, limit: number): CostGroup[] {
  const groups = new Map<string, CostGroup>();
  for (const entry of entries) {
    const key = keyOf(entry);
    const group = groups.get(key) || { key, ...empty() };
    add(group, entry);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.cost - a.cost || b.tokens - a.tokens).slice(0, limit);
}

/** Totals, one entry per day (zeros included) and the top providers, models and projects. */
export function summarizeCosts(entries: CostEntry[], dayCount: number, today = new Date()): CostSummary {
  const days = lastDays(dayCount, today);
  const inRange = new Set(days);
  const kept = entries.filter((entry) => inRange.has(entry.date));

  const total = empty();
  const byDay = new Map(days.map((date) => [date, { date, ...empty() }]));
  for (const entry of kept) {
    add(total, entry);
    const day = byDay.get(entry.date);
    if (day) add(day, entry);
  }

  return {
    total,
    days: days.map((date) => byDay.get(date)!),
    providers: grouped(kept, (entry) => entry.provider, 5),
    models: grouped(kept, (entry) => entry.model, 5),
    projects: grouped(kept, (entry) => entry.project, 5)
  };
}

export function formatUsd(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

export function formatTokens(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
