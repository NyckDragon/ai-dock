import test from "node:test";
import assert from "node:assert/strict";

import { mergeOpenBot, mergeOpenBotActivity, runtimeInfo } from "../src/lib/openbot.ts";
import type { ProviderActivity, ProviderUsage } from "../src/types.ts";

const account = (id: string, gemini: number, extra: Partial<ProviderUsage> = {}): ProviderUsage => ({
  id,
  name: "Antigravity · " + id,
  connected: true,
  windows: [
    { id: "gemini-session", label: "Gemini · 5h", remainingPercent: gemini, resetAt: null },
    { id: "claude-gpt-session", label: "Claude + GPT · 5h", remainingPercent: 100 - gemini, resetAt: null }
  ],
  ...extra
});

test("every OpenBot account becomes one OpenBot entry, where the first one was", () => {
  const providers = [
    account("claude", 50),
    account("antigravity-openbot", 30),
    account("antigravity-2", 90),
    account("antigravity-openbot3", 80)
  ];
  const merged = mergeOpenBot(providers, { slots: ["antigravity-openbot", "antigravity-openbot3", "antigravity-2"], runtimes: [] });
  assert.deepEqual(merged.map((provider) => provider.id), ["claude", "antigravity-openbot", "antigravity-2"]);
  const openbot = merged[1];
  assert.equal(openbot.name, "OpenBot");
  // The most room any OpenBot account has, per window.
  assert.equal(openbot.windows.find((window) => window.id === "gemini-session")?.remainingPercent, 80);
  assert.equal(openbot.windows.find((window) => window.id === "claude-gpt-session")?.remainingPercent, 70);
  // Members list the shared Antigravity account too, after OpenBot's own.
  assert.deepEqual(openbot.members?.map((member) => member.id), ["antigravity-openbot", "antigravity-openbot3", "antigravity-2"]);
});

test("old readings only count when nothing fresh is left", () => {
  const merged = mergeOpenBot([account("antigravity-openbot", 95, { stale: true }), account("antigravity-openbot2", 20)], null);
  assert.equal(merged[0].windows[0].remainingPercent, 20);
  assert.equal(merged[0].stale, undefined);
});

test("without OpenBot accounts nothing changes", () => {
  const providers = [account("claude", 50), account("antigravity", 40)];
  assert.equal(mergeOpenBot(providers, { slots: ["antigravity"], runtimes: ["grok"] }), providers);
});

test("work in any OpenBot account lights the one entry", () => {
  const session = (id: string, state: "working" | "waiting") => ({ id, title: id, state, since: 0 });
  const activities: ProviderActivity[] = [
    { providerId: "codex", state: "working", confidence: "high", sessions: [session("c", "working")] },
    { providerId: "antigravity-openbot2", state: "working", confidence: "high", sessions: [session("a", "working")] },
    { providerId: "antigravity-openbot3", state: "waiting", confidence: "high", sessions: [session("b", "waiting")] }
  ];
  const merged = mergeOpenBotActivity(activities);
  assert.deepEqual(merged.map((activity) => activity.providerId), ["codex", "antigravity-openbot"]);
  assert.equal(merged[1].state, "waiting");
  assert.equal(merged[1].sessions.length, 2);
});

test("runtimes read as names, linked to the dock reading when there is one", () => {
  assert.deepEqual(runtimeInfo("grok"), { name: "Grok", providerId: "grok" });
  assert.deepEqual(runtimeInfo("opencode"), { name: "OpenCode", providerId: null });
  assert.deepEqual(runtimeInfo("hermes"), { name: "Hermes", providerId: null });
});
