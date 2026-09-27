import assert from "node:assert/strict";
import { test } from "node:test";
import { lastDays, summarizeCosts } from "../src/lib/costs.ts";
import type { CostEntry } from "../src/types.ts";

const today = new Date(2026, 8, 27, 15, 0);

function entry(patch: Partial<CostEntry>): CostEntry {
  return {
    date: "2026-09-27",
    provider: "claude",
    model: "claude-sonnet-4-5",
    project: "ai-dock",
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 0,
    cacheReadTokens: 850,
    costUsd: 1,
    ...patch
  };
}

test("lastDays lists local calendar days oldest first, across month ends", () => {
  assert.deepEqual(lastDays(3, new Date(2026, 9, 1, 9)), ["2026-09-29", "2026-09-30", "2026-10-01"]);
  assert.equal(lastDays(30, today).length, 30);
});

test("summarizeCosts keeps only the range and fills empty days with zero", () => {
  const summary = summarizeCosts(
    [entry({}), entry({ date: "2026-09-25", costUsd: 2 }), entry({ date: "2026-08-01", costUsd: 50 })],
    7,
    today
  );
  assert.equal(summary.total.cost, 3);
  assert.equal(summary.total.tokens, 2000);
  assert.equal(summary.days.length, 7);
  assert.equal(summary.days.find((day) => day.date === "2026-09-26")?.cost, 0);
  assert.equal(summary.days.at(-1)?.date, "2026-09-27");
});

test("models without a price count tokens and mark the total as partial", () => {
  const summary = summarizeCosts([entry({}), entry({ model: "new-model", costUsd: null })], 1, today);
  assert.equal(summary.total.cost, 1);
  assert.equal(summary.total.partial, true);
  const unknown = summary.models.find((model) => model.key === "new-model");
  assert.equal(unknown?.cost, 0);
  assert.equal(unknown?.partial, true);
});

test("groups are sorted by cost and capped at five", () => {
  const entries = ["a", "b", "c", "d", "e", "f"].map((project, index) => entry({ project, costUsd: index + 1 }));
  const summary = summarizeCosts(entries, 1, today);
  assert.deepEqual(
    summary.projects.map((group) => group.key),
    ["f", "e", "d", "c", "b"]
  );
});
