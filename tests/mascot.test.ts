import assert from "node:assert/strict";
import test from "node:test";
import {
  CAT_BREATHE,
  MASCOT_SRC,
  hasRobotFrames,
  mascotBang,
  mascotNoticeName,
  MASCOT_NOTICE_LINE,
  mascotNoticeText,
  mascotNotices,
  mascotOverlayHeight,
  mascotPose,
  robotPoseSrc,
  robotWalkPaths
} from "../src/lib/mascot.ts";
import type { ActivitySession, ProviderActivity } from "../src/types.ts";

function activity(id: string, state: ProviderActivity["state"]): ProviderActivity {
  return {
    providerId: id,
    state,
    confidence: "direct",
    sessions: [
      {
        id: id + "-s",
        title: id,
        detail: "",
        state,
        since: 1
      }
    ]
  };
}

test("the notice line stays reserved when the label is shown or hidden", () => {
  assert.equal(MASCOT_NOTICE_LINE, 26);
  assert.equal(mascotOverlayHeight(0), MASCOT_NOTICE_LINE);
  assert.equal(mascotOverlayHeight(22), 22 + MASCOT_NOTICE_LINE);
});

test("mascot art is the sitting, curled and alert drawings", () => {
  assert.equal(decodeURI(MASCOT_SRC.sit).endsWith("/cat-sit.png"), true);
  assert.equal(decodeURI(MASCOT_SRC.sleep).endsWith("/cat-sleep.png"), true);
  assert.equal(decodeURI(MASCOT_SRC.alert).endsWith("/cat-alert.png"), true);
  assert.equal(decodeURI(CAT_BREATHE).endsWith("/cat-breathe.png"), true);
  const used = [...Object.values(MASCOT_SRC), CAT_BREATHE].map(decodeURI).join("\n");
  assert.equal(used.includes("unused"), false);
  assert.equal(used.includes("dormindo"), false);
});

test("every idle slot sleeps, any working sits, and waiting or a finish alerts", () => {
  const slots = [{ id: "claude" }, { id: "codex" }];
  assert.equal(mascotPose([], [], new Set()), "sleep");
  assert.equal(mascotPose(slots, [activity("claude", "idle"), activity("codex", "idle")], new Set()), "sleep");
  assert.equal(mascotPose(slots, [activity("claude", "working"), activity("codex", "idle")], new Set()), "sit");
  assert.equal(mascotPose(slots, [activity("claude", "working"), activity("codex", "waiting")], new Set()), "alert");
  assert.equal(mascotPose(slots, [activity("claude", "working")], new Set(["codex"])), "alert");
  assert.equal(mascotPose(slots, [activity("claude", "idle")], new Set(["claude"])), "alert");
});

function session(id: string, state: ActivitySession["state"], extra: Partial<ActivitySession> = {}): ActivitySession {
  return { id, title: id, detail: "", state, since: 1, ...extra };
}

function waiting(id: string, sessions: ActivitySession[]): ProviderActivity {
  return { providerId: id, state: "waiting", confidence: "direct", sessions };
}

test("question, permission and a finish each get their own line", () => {
  const slots = [
    { id: "codex", name: "Codex" },
    { id: "cursor", name: "Cursor" },
    { id: "claude", name: "Claude" }
  ];
  const notices = mascotNotices(
    slots,
    [
      waiting("codex", [session("q", "waiting", { reason: "question" })]),
      waiting("cursor", [session("bare", "waiting")]),
      waiting("claude", [session("p", "waiting", { reason: "permission" })])
    ],
    new Set(["codex"])
  );
  assert.deepEqual(
    notices.map((notice) => notice.kind + ":" + notice.name),
    ["question:Codex", "done:Codex", "question:Cursor", "permission:Claude"]
  );
  assert.equal(mascotBang(notices), "permission");
  assert.equal(mascotNoticeText(notices[0]), "Codex tem uma pergunta");
  assert.equal(mascotNoticeText(notices[1]), "Codex finalizou");
  assert.equal(mascotNoticeText(notices[3]), "Claude precisa de permissão");
});

test("a waiting slot with no session still asks, and a finish alone is not a question", () => {
  const slots = [{ id: "grok", name: "Grok" }];
  const asking = mascotNotices(slots, [waiting("grok", [])], new Set());
  assert.deepEqual(asking.map((notice) => notice.kind), ["question"]);
  const finished = mascotNotices(slots, [activity("grok", "idle")], new Set(["grok"]));
  assert.deepEqual(finished.map((notice) => notice.kind), ["done"]);
  assert.equal(mascotBang(finished), "done");
  assert.equal(mascotBang([]), null);
});

test("antigravity uses the dock name, and adds the family when the slot is still the account", () => {
  const split = { id: "antigravity-2-gemini", name: "Gemini · Trabalho" };
  assert.equal(mascotNoticeName(split, "gemini"), "Gemini · Trabalho");
  const grouped = { id: "antigravity", name: "Meu AG" };
  assert.equal(mascotNoticeName(grouped, "claude-gpt"), "Meu AG · Claude + GPT");
  assert.equal(mascotNoticeName(grouped, "gemini"), "Meu AG · Gemini");
  assert.equal(mascotNoticeName({ id: "antigravity", name: "Gemini" }, "gemini"), "Gemini");

  const notices = mascotNotices(
    [grouped],
    [
      waiting("antigravity", [
        session("g", "waiting", { pool: "gemini" }),
        session("g2", "waiting", { pool: "gemini", reason: "question" }),
        session("c", "waiting", { pool: "claude-gpt", reason: "permission" })
      ])
    ],
    new Set()
  );
  assert.deepEqual(
    notices.map((notice) => notice.kind + ":" + notice.name),
    ["question:Meu AG · Gemini", "permission:Meu AG · Claude + GPT"]
  );
});

test("robot art is ready with the idle frame, and walk frames stay in order", () => {
  const ready = ["robot-idle.png", "robot-walk.png", "robot-alert.png", "robot-sleep.png"];
  assert.equal(hasRobotFrames(ready), true);
  assert.equal(hasRobotFrames(["Robot-Idle.png"]), true);
  assert.equal(hasRobotFrames(ready.filter((name) => name !== "robot-idle.png")), false);
  assert.equal(hasRobotFrames(["Robô Pixelado com Olhos Verdes.png"]), false);

  const paths = [
    "public/mascot/robot-walk-10.png",
    "public/mascot/robot-idle.png",
    "public/mascot/robot-walk-2.png",
    "public/mascot/robot-walk.png"
  ];
  assert.deepEqual(robotWalkPaths(paths), [
    "public/mascot/robot-walk.png",
    "public/mascot/robot-walk-2.png",
    "public/mascot/robot-walk-10.png"
  ]);

  const files = {
    "public/mascot/robot-idle.png": "/idle",
    "public/mascot/robot-walk.png": "/walk",
    "public/mascot/robot-walk-2.png": "/walk-2",
    "public/mascot/robot-alert.png": "/alert",
    "public/mascot/robot-sleep.png": "/sleep"
  };
  assert.deepEqual(robotPoseSrc("alert", files), { src: "/alert", frames: [] });
  assert.deepEqual(robotPoseSrc("sit", files), { src: "/walk", frames: ["/walk", "/walk-2"] });
  assert.deepEqual(robotPoseSrc("sleep", files), { src: "/idle", frames: [] });
  assert.deepEqual(robotPoseSrc("sleep", { "public/mascot/robot-sleep.png": "/sleep" }), { src: "/sleep", frames: [] });
  assert.deepEqual(robotPoseSrc("sit", { "public/mascot/robot-idle.png": "/idle" }), { src: "/idle", frames: [] });
  assert.deepEqual(robotPoseSrc("alert", { "public/mascot/robot-idle.png": "/idle" }), { src: "/idle", frames: [] });
});
