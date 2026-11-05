import assert from "node:assert/strict";
import test from "node:test";
import { clearFinish, IDLE_TRACK, stepFinish, stripNotice, waitKind } from "../src/lib/finish.ts";
import type { ProviderActivity } from "../src/types.ts";

function activity(state: ProviderActivity["state"], reasons: Array<"permission" | "question" | undefined>): ProviderActivity {
  return {
    providerId: "codex",
    state,
    confidence: "direct",
    sessions: reasons.map((reason, index) => ({
      id: "s" + index,
      title: "Codex",
      detail: "",
      state: state === "idle" ? "idle" : state,
      since: 1,
      reason
    }))
  };
}

test("permission wins over question, and a waiting session with no reason stays a question", () => {
  assert.equal(waitKind(undefined), null);
  assert.equal(waitKind(activity("working", [undefined])), null);
  assert.equal(waitKind(activity("waiting", [undefined])), "question");
  assert.equal(waitKind(activity("waiting", ["question"])), "question");
  assert.equal(waitKind(activity("waiting", ["question", "permission"])), "permission");
});

test("one idle poll between working samples does not light finish", () => {
  const pending = stepFinish({ phase: "working", pendingAt: null, doneAt: null }, "idle", 1_000);
  assert.equal(pending.phase, "pending");
  const resumed = stepFinish(pending, "working", 4_000);
  assert.equal(resumed.phase, "working");
  assert.equal(resumed.doneAt, null);
});

test("idle that stays 8s lights, waiting cancels, and the light holds for 2 minutes", () => {
  const pending = stepFinish({ phase: "working", pendingAt: null, doneAt: null }, "idle", 10_000);
  assert.equal(stepFinish(pending, "idle", 17_999).phase, "pending");
  const done = stepFinish(pending, "idle", 18_000);
  assert.equal(done.phase, "done");
  assert.equal(done.doneAt, 18_000);
  assert.equal(stepFinish(done, "idle", 18_000 + 119_000).phase, "done");
  assert.equal(stepFinish(done, "idle", 18_000 + 120_000).phase, "idle");
  assert.equal(stepFinish(pending, "waiting", 12_000), IDLE_TRACK);
  assert.equal(stepFinish(done, "working", 20_000).phase, "working");
});

test("the hidden strip keeps the winning notice", () => {
  assert.deepEqual(stripNotice({ permission: true, question: true, working: true, done: true }), {
    activity: "waiting",
    wait: "permission",
    done: false
  });
  assert.deepEqual(stripNotice({ permission: false, question: true, working: false, done: true }), {
    activity: "waiting",
    wait: "question",
    done: false
  });
  assert.deepEqual(stripNotice({ permission: false, question: false, working: true, done: true }), {
    activity: "working",
    wait: null,
    done: true
  });
  assert.deepEqual(stripNotice({ permission: false, question: false, working: false, done: true }), {
    activity: "idle",
    wait: null,
    done: true
  });
});

test("looking at the dock clears the light and idle does not arm it again", () => {
  const done = stepFinish({ phase: "working", pendingAt: null, doneAt: null }, "idle", 0);
  const confirmed = stepFinish(done, "idle", 8_000);
  const cleared = clearFinish(confirmed);
  assert.equal(cleared.phase, "idle");
  assert.equal(stepFinish(cleared, "idle", 20_000).phase, "idle");
});
