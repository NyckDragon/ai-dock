import test from "node:test";
import assert from "node:assert/strict";

import { mergeProviderSnapshots } from "../src/lib/snapshots.ts";
import type { ProviderUsage } from "../src/types.ts";

function provider(overrides: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    id: "claude",
    name: "Claude",
    connected: true,
    plan: "Web",
    windows: [
      {
        id: "session",
        label: "Sessão · 5h",
        remainingPercent: 24,
        resetAt: "2026-09-23T07:20:00Z"
      }
    ],
    error: null,
    stale: false,
    updatedAt: 100,
    lastErrorAt: null,
    ...overrides
  };
}

test("successful snapshot replaces prior data and clears stale", () => {
  const previous = [provider({ stale: true, error: "old error", updatedAt: 100 })];
  const incoming = [provider({ windows: [{ id: "session", label: "Sessão · 5h", remainingPercent: 20 }] })];

  const [merged] = mergeProviderSnapshots(previous, incoming, 200);

  assert.equal(merged.windows[0].remainingPercent, 20);
  assert.equal(merged.stale, false);
  assert.equal(merged.updatedAt, 200);
  assert.equal(merged.lastErrorAt, null);
});

test("temporary failure preserves last-good windows as stale", () => {
  const previous = [provider({ updatedAt: 100 })];
  const incoming = [
    provider({
      connected: false,
      windows: [],
      error: "Cloudflare cooldown",
      updatedAt: null
    })
  ];

  const [merged] = mergeProviderSnapshots(previous, incoming, 300);

  assert.equal(merged.connected, false);
  assert.equal(merged.windows[0].remainingPercent, 24);
  assert.equal(merged.stale, true);
  assert.equal(merged.error, "Cloudflare cooldown");
  assert.equal(merged.updatedAt, 100);
  assert.equal(merged.lastErrorAt, 300);
});

test("provider without prior reading does not invent last-good data", () => {
  const incoming = [
    provider({
      id: "codex",
      name: "Codex",
      connected: false,
      windows: [],
      error: "Not connected",
      updatedAt: null
    })
  ];

  const [merged] = mergeProviderSnapshots([], incoming, 400);

  assert.equal(merged.windows.length, 0);
  assert.equal(merged.stale, false);
  assert.equal(merged.updatedAt, 400);
  assert.equal(merged.lastErrorAt, 400);
});
