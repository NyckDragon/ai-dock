import test from "node:test";
import assert from "node:assert/strict";

import { withAccountPins, wrongAccount } from "../src/lib/accounts.ts";
import type { ProviderUsage } from "../src/types.ts";

function slot(id: string, email: string | null, extra: Partial<ProviderUsage> = {}): ProviderUsage {
  return { id, name: id, connected: true, email, windows: [], error: null, ...extra };
}

test("only the bound accounts get the expected email", () => {
  const [main, second, codex] = withAccountPins(
    [slot("antigravity", "ana@example.com"), slot("antigravity-2", "bia@example.com"), slot("codex", null)],
    { "antigravity-2": "bia@example.com" }
  );
  assert.equal(main.expectedEmail, undefined);
  assert.equal(second.expectedEmail, "bia@example.com");
  assert.equal(codex.expectedEmail, undefined);
});

test("a window signed in with another account is flagged", () => {
  assert.equal(wrongAccount(slot("antigravity-2", "ana@example.com", { expectedEmail: "bia@example.com" })), true);
});

test("case and spaces do not count as another account", () => {
  assert.equal(wrongAccount(slot("antigravity-2", " Bia@Example.com", { expectedEmail: "bia@example.com" })), false);
});

test("without a live reading there is nothing to compare", () => {
  const bound = { expectedEmail: "bia@example.com" };
  assert.equal(wrongAccount(slot("antigravity-2", null, bound)), false);
  assert.equal(wrongAccount(slot("antigravity-2", "ana@example.com", { ...bound, connected: false })), false);
  assert.equal(wrongAccount(slot("antigravity-2", "ana@example.com", { ...bound, stale: true })), false);
  assert.equal(wrongAccount(slot("antigravity-2", "ana@example.com")), false);
});
