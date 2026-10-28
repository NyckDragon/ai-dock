import type { ProviderActivity } from "../types";

export type WaitKind = "permission" | "question";

/** Waiting with no reason keeps the question color. Permission wins on the same account. */
export function waitKind(activity: ProviderActivity | undefined): WaitKind | null {
  if (!activity || activity.state !== "waiting") return null;
  const waiting = activity.sessions.filter((session) => session.state === "waiting");
  const source = waiting.length ? waiting : activity.sessions;
  if (source.some((session) => session.reason === "permission")) return "permission";
  return "question";
}

export type FinishPhase = "idle" | "working" | "pending" | "done";

export type FinishTrack = {
  phase: FinishPhase;
  pendingAt: number | null;
  doneAt: number | null;
};

export const IDLE_TRACK: FinishTrack = { phase: "idle", pendingAt: null, doneAt: null };

const CONFIRM_MS = 8000;
const HOLD_MS = 2 * 60 * 1000;

/**
 * Working that settles into idle arms a finish. One idle poll between working
 * samples stays pending and is dropped if work returns within 8s. Waiting is
 * not a finish. The lit signal holds for 2 minutes.
 */
export function stepFinish(track: FinishTrack, state: "working" | "waiting" | "idle", now: number): FinishTrack {
  if (state === "waiting") {
    return track.phase === "idle" ? track : IDLE_TRACK;
  }
  if (state === "working") {
    return track.phase === "working" ? track : { phase: "working", pendingAt: null, doneAt: null };
  }
  if (track.phase === "working") {
    return { phase: "pending", pendingAt: now, doneAt: null };
  }
  if (track.phase === "pending" && track.pendingAt != null) {
    if (now - track.pendingAt < CONFIRM_MS) return track;
    return { phase: "done", pendingAt: null, doneAt: now };
  }
  if (track.phase === "done" && track.doneAt != null) {
    if (now - track.doneAt < HOLD_MS) return track;
    return IDLE_TRACK;
  }
  return track.phase === "idle" ? track : IDLE_TRACK;
}

/** Looking at the dock clears a pending or lit finish. Idle alone does not arm it again. */
export function clearFinish(track: FinishTrack): FinishTrack {
  if (track.phase !== "done" && track.phase !== "pending") return track;
  return IDLE_TRACK;
}

export type StripNotice = {
  activity: "working" | "waiting" | "idle";
  wait: WaitKind | null;
  done: boolean;
};

/** Permission beats question. Waiting beats a finish. The cap stays while that notice lasts. */
export function stripNotice(flags: {
  permission: boolean;
  question: boolean;
  working: boolean;
  done: boolean;
}): StripNotice {
  if (flags.permission) return { activity: "waiting", wait: "permission", done: false };
  if (flags.question) return { activity: "waiting", wait: "question", done: false };
  if (flags.done) return { activity: flags.working ? "working" : "idle", wait: null, done: true };
  return { activity: flags.working ? "working" : "idle", wait: null, done: false };
}
