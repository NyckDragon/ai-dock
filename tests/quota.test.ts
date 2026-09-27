import test from "node:test";
import assert from "node:assert/strict";

import { displayKind, displayWord, featuredWindow, percentLabel, providerHeadroom, shownPercent, windowPace } from "../src/lib/quota.ts";
import { formatPace } from "../src/lib/format.ts";

test("native display: Claude shows consumed percentage, like claude.ai", () => {
  assert.equal(displayKind("native", "claude"), "used");
  assert.equal(displayWord("native", "claude"), "usado");
  assert.equal(shownPercent(24, "native", "claude"), 76);
  assert.equal(shownPercent(70, "native", "claude"), 30);
});

test("native display: headroom providers keep remaining percentage", () => {
  for (const providerId of ["codex", "cursor", "antigravity", "antigravity-gemini", "antigravity-gpt"]) {
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
