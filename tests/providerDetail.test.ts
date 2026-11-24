import test from "node:test";
import assert from "node:assert/strict";

import { costKeyFor, dailyCosts, dailyPeakUsed, quotaState, todayTotals } from "../src/lib/providerDetail.ts";
import type { CostEntry } from "../src/types.ts";

const today = new Date(2026, 10, 24, 12);
const entry = (date: string, provider: string, costUsd: number | null, cacheReadTokens = 0): CostEntry => ({
  date,
  provider,
  model: "m",
  project: "p",
  inputTokens: 100,
  outputTokens: 50,
  cacheWriteTokens: 0,
  cacheReadTokens,
  costUsd
});

test("each provider reads its own cost log; Antigravity accounts share one", () => {
  assert.equal(costKeyFor("claude"), "claude");
  assert.equal(costKeyFor("antigravity-3"), "antigravity");
  assert.equal(costKeyFor("antigravity-openbot"), null);
  assert.equal(costKeyFor("grok"), null);
});

test("daily costs keep one value per day, oldest first, zeros included", () => {
  const entries = [entry("2026-11-24", "claude", 2), entry("2026-11-24", "claude", 1.5), entry("2026-11-22", "claude", 4), entry("2026-11-24", "codex", 9)];
  assert.deepEqual(
    dailyCosts(entries, "claude", "cost", 3, today).map((day) => day.value),
    [4, 0, 3.5]
  );
  assert.deepEqual(
    dailyCosts([entry("2026-11-24", "claude", 1, 400)], "claude", "cache", 1, today).map((day) => day.value),
    [400]
  );
});

test("today totals add up spending, tokens and the cache share", () => {
  const totals = todayTotals([entry("2026-11-24", "codex", 3, 150), entry("2026-11-24", "codex", null), entry("2026-11-23", "codex", 50)], "codex", today);
  assert.equal(totals.cost, 3);
  assert.equal(totals.tokens, 450);
  assert.equal(totals.priced, false);
  assert.equal(totals.cacheShare, 33);
});

test("the daily peak is the most used reading of each day", () => {
  const at = (day: number, hour: number) => new Date(2026, 10, day, hour).getTime();
  const peaks = dailyPeakUsed([[at(23, 9), 80], [at(23, 18), 30], [at(24, 8), 95]], 2, today);
  assert.deepEqual(peaks.map((day) => day.value), [70, 5]);
});

test("the state follows what is left", () => {
  assert.equal(quotaState(80), "healthy");
  assert.equal(quotaState(40), "warning");
  assert.equal(quotaState(10), "critical");
  assert.equal(quotaState(0), "depleted");
  assert.equal(quotaState(null), "unknown");
});
