import test from "node:test";
import assert from "node:assert/strict";

import { antigravityAccounts, bestAccount, sessionPools } from "../src/lib/accountsOverview.ts";
import type { ProviderUsage } from "../src/types.ts";

function account(id: string, gemini: number, claude: number, extra: Partial<ProviderUsage> = {}): ProviderUsage {
  return {
    id,
    name: "Antigravity · " + id,
    connected: true,
    email: id + "@example.com",
    error: null,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: gemini },
      { id: "gemini-weekly", label: "Gemini · Semanal", remainingPercent: 99 },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: claude }
    ],
    ...extra
  };
}

test("each account shows its 5h session per model pool", () => {
  assert.deepEqual(
    sessionPools(account("antigravity-2", 72.4, 65)).map((pool) => [pool.label, pool.remaining]),
    [
      ["Gemini", 72],
      ["Claude", 65]
    ]
  );
});

test("the best account is the one whose tightest pool has the most room", () => {
  const accounts = [account("antigravity", 90, 20), account("antigravity-2", 60, 55), account("antigravity-3", 40, 99)];
  assert.equal(bestAccount(accounts)?.id, "antigravity-2");
});

test("wrong, closed or stale accounts are never suggested", () => {
  const accounts = [
    account("antigravity", 99, 99, { expectedEmail: "other@example.com" }),
    account("antigravity-2", 98, 98, { connected: false }),
    account("antigravity-3", 97, 97, { stale: true }),
    account("antigravity-4", 10, 10)
  ];
  assert.equal(bestAccount(accounts)?.id, "antigravity-4");
});

test("OpenBot slots are not accounts", () => {
  const ids = antigravityAccounts([account("antigravity", 1, 1), account("antigravity-openbot", 1, 1), { ...account("x", 1, 1), id: "codex" }]).map((a) => a.id);
  assert.deepEqual(ids, ["antigravity"]);
});

test("an agent nearly out in its model gets pointed to the account with the most of it", async () => {
  const { switchSuggestion } = await import("../src/lib/accountsOverview.ts");
  const acct = (id: string, gemini: number, claude: number) => ({
    id,
    name: id,
    connected: true,
    windows: [
      { id: "gemini-session", label: "Gemini · 5h", remainingPercent: gemini, resetAt: null },
      { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: claude, resetAt: null }
    ]
  });
  const working = (id: string, pool?: "gemini" | "claude-gpt") => ({
    providerId: id,
    state: "working" as const,
    confidence: "direct" as const,
    sessions: [{ id: "s", title: "t", detail: "", state: "working" as const, since: 0, pool }]
  });
  const accounts = [acct("antigravity", 8, 90), acct("antigravity-2", 60, 20), acct("antigravity-3", 91, 70)];

  const suggestion = switchSuggestion(accounts, [working("antigravity", "gemini")]);
  assert.equal(suggestion?.to.id, "antigravity-3");
  assert.equal(suggestion?.pool, "Gemini");
  assert.equal(suggestion?.fromRemaining, 8);
  // Working in Claude, where it still has room: nothing to change.
  assert.equal(switchSuggestion(accounts, [working("antigravity", "claude-gpt")]), null);
  // Nobody working: nothing to suggest.
  assert.equal(switchSuggestion(accounts, []), null);
  // Unknown model: the tightest pool counts.
  assert.equal(switchSuggestion(accounts, [working("antigravity")])?.to.id, "antigravity-3");
});
