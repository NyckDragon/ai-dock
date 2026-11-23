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
