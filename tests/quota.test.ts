import test from "node:test";
import assert from "node:assert/strict";

import {
  activityForSlot,
  antigravityPools,
  compactSlots,
  displayKind,
  displayWord,
  featuredWindow,
  percentLabel,
  providerHeadroom,
  shownPercent,
  windowPace
} from "../src/lib/quota.ts";
import { formatPace } from "../src/lib/format.ts";
import type { ActivitySession, ProviderActivity } from "../src/types.ts";

function antigravity(...pools: Array<ActivitySession["pool"]>): ProviderActivity[] {
  return account("antigravity", ...pools);
}

function account(providerId: string, ...pools: Array<ActivitySession["pool"]>): ProviderActivity[] {
  return [
    {
      providerId,
      state: "working",
      confidence: "inferred",
      sessions: pools.map((pool, index) => ({ id: "s" + index, title: "Antigravity", detail: "", state: "working", since: 1, pool }))
    }
  ];
}

test("a Gemini session lights only the Gemini slot", () => {
  const activities = antigravity("gemini");
  assert.equal(activityForSlot(activities, "antigravity-gemini")?.state, "working");
  assert.equal(activityForSlot(activities, "antigravity-gpt"), undefined);
  assert.equal(activityForSlot(activities, "antigravity")?.sessions.length, 1);
});

test("sessions in both pools light both slots, each with its own", () => {
  const activities = antigravity("gemini", "claude-gpt");
  assert.deepEqual(activityForSlot(activities, "antigravity-gemini")?.sessions.map((s) => s.pool), ["gemini"]);
  assert.deepEqual(activityForSlot(activities, "antigravity-gpt")?.sessions.map((s) => s.pool), ["claude-gpt"]);
});

test("an unknown pool still lights both Antigravity slots", () => {
  const activities = antigravity(undefined);
  assert.equal(activityForSlot(activities, "antigravity-gemini")?.state, "working");
  assert.equal(activityForSlot(activities, "antigravity-gpt")?.state, "working");
});

test("each Antigravity account lights only its own slot", () => {
  const activities = account("antigravity-2", "gemini");
  assert.equal(activityForSlot(activities, "antigravity"), undefined);
  assert.equal(activityForSlot(activities, "antigravity-2")?.state, "working");
  assert.equal(activityForSlot(activities, "antigravity-2-gemini")?.state, "working");
  assert.equal(activityForSlot(activities, "antigravity-2-gpt"), undefined);
  assert.equal(activityForSlot(activities, "antigravity-gemini"), undefined);
});

test("an Argon session lights only the Argon slot", () => {
  const activities = antigravity("argon");
  assert.equal(activityForSlot(activities, "antigravity-argon")?.state, "working");
  assert.equal(activityForSlot(activities, "antigravity-gemini"), undefined);
});

test("native display: Claude shows consumed percentage, like claude.ai", () => {
  assert.equal(displayKind("native", "claude"), "used");
  assert.equal(displayWord("native", "claude"), "usado");
  assert.equal(shownPercent(24, "native", "claude"), 76);
  assert.equal(shownPercent(70, "native", "claude"), 30);
});

test("native display: headroom providers keep remaining percentage", () => {
  for (const providerId of ["codex", "cursor", "antigravity", "antigravity-gemini", "antigravity-gpt", "antigravity-argon", "antigravity-2"]) {
    assert.equal(displayKind("native", providerId), "remaining");
    assert.equal(displayWord("native", providerId), "restante");
    assert.equal(shownPercent(64, "native", providerId), 64);
  }
});

test("explicit display applies to every provider", () => {
  assert.equal(shownPercent(24, "remaining", "claude"), 24);
  assert.equal(shownPercent(64, "used", "codex"), 36);
});

test("display percentage is clamped", () => {
  assert.equal(shownPercent(-20, "native", "codex"), 0);
  assert.equal(shownPercent(140, "native", "codex"), 100);
  assert.equal(shownPercent(-20, "native", "claude"), 100);
  assert.equal(shownPercent(140, "native", "claude"), 0);
});

test("the dock features the current session, or the most limiting window on request", () => {
  const claude = {
    id: "claude",
    name: "Claude",
    connected: true,
    windows: [
      { id: "session", label: "Sessão · 5h", remainingPercent: 65 },
      { id: "weekly", label: "Semanal", remainingPercent: 31 }
    ]
  };
  assert.equal(featuredWindow(claude, "session")?.id, "session");
  assert.equal(featuredWindow(claude, "limiting")?.id, "weekly");
  assert.equal(providerHeadroom(claude, "session"), 65);
  assert.equal(providerHeadroom(claude), 31);
});

test("providers without a session window fall back to the most limiting one", () => {
  const cursor = { id: "cursor", name: "Cursor", connected: true, windows: [{ id: "included", label: "Uso incluído", remainingPercent: 88 }] };
  assert.equal(featuredWindow(cursor, "session")?.id, "included");
  const gemini = { id: "antigravity-gemini", name: "Gemini", connected: true, windows: [
    { id: "gemini-weekly", label: "Gemini · semanal", remainingPercent: 53 },
    { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 0 }
  ] };
  assert.equal(featuredWindow(gemini, "session")?.id, "gemini-session");
  assert.equal(featuredWindow({ id: "codex", name: "Codex", connected: false, windows: [] }, "session"), null);
});

test("percent label handles missing data and the % sign", () => {
  assert.equal(percentLabel(null, "native", "codex"), "--");
  assert.equal(percentLabel(40, "native", "codex"), "40%");
  assert.equal(percentLabel(40, "native", "codex", false), "40");
});

const HOUR = 3_600_000;

test("pace projects when a 5h window runs out before its reset", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  // 2h into a 5h window, 82% used: it runs out in about 26 minutes.
  const window = { id: "session", label: "Sessão · 5h", remainingPercent: 18, resetAt: new Date(now + 3 * HOUR).toISOString() };
  const pace = windowPace(window, now);
  assert.ok(pace);
  assert.ok(pace.runsOutIn != null && Math.abs(pace.runsOutIn - 26.3 * 60_000) < 60_000);
  assert.equal(formatPace(pace)?.text, "Esgota em 26min");
  assert.equal(formatPace(pace)?.tone, "danger");
});

test("pace reports a steady or slow window without a run-out time", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  const steady = { id: "weekly", label: "Semanal", remainingPercent: 50, resetAt: new Date(now + 84 * HOUR).toISOString() };
  assert.equal(formatPace(windowPace(steady, now))?.text, "No ritmo");
  const slow = { id: "session", label: "Sessão", remainingPercent: 90, resetAt: new Date(now + 2 * HOUR).toISOString() };
  assert.equal(formatPace(windowPace(slow, now))?.text, "50% abaixo do ritmo");
});

test("pace is skipped when the window length is unknown or just started", () => {
  const now = Date.parse("2026-09-26T12:00:00Z");
  assert.equal(windowPace({ id: "mystery", label: "?", remainingPercent: 10, resetAt: new Date(now + HOUR).toISOString() }, now), null);
  assert.equal(windowPace({ id: "session", label: "Sessão", remainingPercent: 99, resetAt: new Date(now + 4.9 * HOUR).toISOString() }, now), null);
  assert.equal(windowPace({ id: "session", label: "Sessão", remainingPercent: 50, resetAt: null }, now), null);
});

test("compactSlots: bars mode keeps provider fused with all windows", () => {
  const antigravity = {
    id: "antigravity",
    name: "Antigravity (Hotmail)",
    connected: true,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 80 },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: 50 },
      { id: "argon-weekly", label: "Argon · semanal", remainingPercent: 95 }
    ]
  };
  const slots = compactSlots([antigravity], "bars");
  assert.equal(slots.length, 1);
  assert.equal(slots[0].id, "antigravity");
  assert.equal(slots[0].windows.length, 3);
});

test("compactSlots: split mode separates gemini, claude-gpt, and argon", () => {
  const antigravity = {
    id: "antigravity",
    name: "Antigravity",
    connected: true,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 80 },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: 50 },
      { id: "argon-weekly", label: "Argon · semanal", remainingPercent: 95 }
    ]
  };
  const slots = compactSlots([antigravity], "split");
  assert.equal(slots.length, 3);
  assert.equal(slots[0].id, "antigravity-gemini");
  assert.equal(slots[1].id, "antigravity-gpt");
  assert.equal(slots[2].id, "antigravity-argon");
});

test("compactSlots: split mode keeps each account apart", () => {
  const second = {
    id: "antigravity-2",
    name: "Antigravity · Conta 2",
    connected: true,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 80 },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: 50 }
    ]
  };
  const slots = compactSlots([second], "split");
  assert.deepEqual(slots.map((slot) => slot.id), ["antigravity-2-gemini", "antigravity-2-gpt"]);
  assert.equal(slots[0].name, "Gemini · Conta 2");
});

test("antigravityPools extracts featured window and resolves colors", () => {
  const antigravity = {
    id: "antigravity",
    name: "Antigravity",
    connected: true,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 90 },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: 20 },
      { id: "argon-weekly", label: "Argon · semanal", remainingPercent: 50 }
    ]
  };
  const pools = antigravityPools(antigravity);
  assert.equal(pools.length, 3);

  // Gemini is healthy (>60%)
  assert.equal(pools[0].id, "gemini");
  assert.equal(pools[0].remainingPercent, 90);
  assert.equal(pools[0].tone, "good");
  assert.equal(pools[0].color, "#38bdf8");

  // Claude is in danger (<25%)
  assert.equal(pools[1].id, "claude-gpt");
  assert.equal(pools[1].remainingPercent, 20);
  assert.equal(pools[1].tone, "danger");
  assert.equal(pools[1].color, "var(--danger)");

  // Argon is in warning (25-60%)
  assert.equal(pools[2].id, "argon");
  assert.equal(pools[2].remainingPercent, 50);
  assert.equal(pools[2].tone, "warning");
  assert.equal(pools[2].color, "var(--warning)");
});

test("mergeProviderSnapshots retains closed instances as stale/offline", async () => {
  const { mergeProviderSnapshots } = await import("../src/lib/snapshots.ts");
  const previous = [
    {
      id: "antigravity",
      name: "Antigravity (1)",
      connected: true,
      windows: [{ id: "gemini", label: "Gemini", remainingPercent: 80 }]
    },
    {
      id: "antigravity-2",
      name: "Antigravity (Conta 2)",
      connected: true,
      windows: [{ id: "gemini", label: "Gemini", remainingPercent: 15 }]
    }
  ];
  // Incoming reading only detected instance 1 (instance 2 was closed)
  const incoming = [
    {
      id: "antigravity",
      name: "Antigravity (1)",
      connected: true,
      windows: [{ id: "gemini", label: "Gemini", remainingPercent: 78 }]
    }
  ];
  const merged = mergeProviderSnapshots(previous as any, incoming as any, 123456);
  assert.equal(merged.length, 2);
  const inst1 = merged.find((p) => p.id === "antigravity");
  const inst2 = merged.find((p) => p.id === "antigravity-2");
  assert.ok(inst1);
  assert.equal(inst1?.connected, true);
  assert.equal(inst1?.stale, false);
  assert.ok(inst2);
  assert.equal(inst2?.connected, false);
  assert.equal(inst2?.stale, true);
  assert.equal(inst2?.windows.length, 1);
  assert.equal(inst2?.windows[0].remainingPercent, 15);
  assert.equal(inst2?.error, "Aplicativo fechado");
});

