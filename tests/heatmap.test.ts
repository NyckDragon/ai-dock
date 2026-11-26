import test from "node:test";
import assert from "node:assert/strict";

import { buildHeatmap, mergeDailyCosts, type DailyStore } from "../src/lib/heatmap.ts";
import type { CostEntry } from "../src/types.ts";

// Tuesday, 24 Nov 2026.
const today = new Date(2026, 10, 24, 12);
const entry = (date: string, provider: string, costUsd: number | null, tokens = 100): CostEntry => ({
  date,
  provider,
  model: "m",
  project: "p",
  inputTokens: tokens,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
  costUsd
});

test("a report is folded into one total per day and tool", () => {
  const store = mergeDailyCosts({}, [entry("2026-11-24", "claude", 2), entry("2026-11-24", "claude", 1.5, 50), entry("2026-11-23", "codex", null)], today);
  assert.deepEqual(store, { "2026-11-24": { claude: [3.5, 150] }, "2026-11-23": { codex: [0, 100] } });
});

test("days keep their largest reading, so deleted logs do not erase history", () => {
  const saved: DailyStore = { "2026-10-01": { claude: [40, 9000] }, "2026-11-20": { claude: [5, 500] } };
  const store = mergeDailyCosts(saved, [entry("2026-11-20", "claude", 3, 300), entry("2026-11-24", "claude", 1)], today);
  assert.deepEqual(store["2026-10-01"], { claude: [40, 9000] });
  assert.deepEqual(store["2026-11-20"], { claude: [5, 500] });
  assert.deepEqual(store["2026-11-24"], { claude: [1, 100] });
});

test("days older than a year are dropped", () => {
  const store = mergeDailyCosts({ "2025-01-01": { claude: [1, 1] } }, [], today);
  assert.deepEqual(store, {});
});

test("the map ends on today, weeks start on Sunday and future days are empty", () => {
  const map = buildHeatmap({}, "all", 4, today);
  assert.equal(map.weeks.length, 4);
  assert.ok(map.weeks.every((week) => week.length === 7));
  assert.equal(map.weeks[0][0]?.date, "2026-11-01");
  assert.equal(map.weeks[3][2]?.date, "2026-11-24");
  assert.equal(map.weeks[3][3], null);
  assert.equal(map.activeDays, 0);
});

test("levels split active days by spending and follow the tool filter", () => {
  const store: DailyStore = {
    "2026-11-20": { claude: [1, 10] },
    "2026-11-21": { claude: [2, 10] },
    "2026-11-22": { claude: [3, 10], codex: [100, 10] },
    "2026-11-23": { claude: [4, 10] }
  };
  const levels = (tool: string) =>
    buildHeatmap(store, tool, 2, today)
      .weeks.flat()
      .filter((cell) => cell && cell.date >= "2026-11-20" && cell.date <= "2026-11-23")
      .map((cell) => cell!.level);
  assert.deepEqual(levels("claude"), [1, 2, 3, 4]);
  assert.deepEqual(levels("codex"), [0, 0, 4, 0]);
  const all = buildHeatmap(store, "all", 2, today);
  assert.equal(all.activeDays, 4);
  assert.equal(all.totalCost, 110);
});

test("without prices the levels come from tokens", () => {
  const map = buildHeatmap({ "2026-11-23": { antigravity: [0, 10] }, "2026-11-24": { antigravity: [0, 900] } }, "all", 1, today);
  assert.deepEqual(map.weeks[0].slice(1, 3).map((cell) => cell?.level), [2, 4]);
});

test("month labels sit over the week of the first day, never crowded", () => {
  const map = buildHeatmap({}, "all", 26, today);
  const dates = map.months.map((month) => month.date.slice(0, 7));
  assert.deepEqual(dates.slice(-3), ["2026-09", "2026-10", "2026-11"]);
  for (let index = 1; index < map.months.length; index += 1) {
    assert.ok(map.months[index].column - map.months[index - 1].column >= 3);
  }
});

test("the first column is named after the month that starts in it", () => {
  // 26 weeks back from 24 Nov 2026 starts on Sunday 31 May; June starts the next day.
  const map = buildHeatmap({}, "all", 26, today);
  assert.equal(map.months[0].column, 0);
  assert.equal(map.months[0].date, "2026-06-01");
});
