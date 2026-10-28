import type { ProviderActivity } from "../types";
import { t } from "./i18n.ts";
import { activityForSlot } from "./quota.ts";

/**
 * The cat is a 64px image in `dock.css`, centered on the 58px pill.
 * `dock.rs` adds that height upward and any extra width toward the center.
 * Hidden and expanded add nothing.
 */

export type MascotPose = "sit" | "sleep" | "alert";
export type MascotKind = "cat" | "robot";

/**
 * One notice line above the cat, in CSS pixels. Reserved the whole time the
 * mascot is up, so showing the label does not change the window.
 * `dock.css` `.dock-signal-list` uses this same height.
 */
export const MASCOT_NOTICE_LINE = 26;

/** Height above the cat. Marks may add their own box; the label never does. */
export function mascotOverlayHeight(marksAboveCat: number): number {
  return Math.max(0, marksAboveCat) + MASCOT_NOTICE_LINE;
}

const file = (name: string) => encodeURI("/mascot/" + name);

export const MASCOT_SRC: Record<MascotPose, string> = {
  sit: file("cat-sit.png"),
  sleep: file("cat-sleep.png"),
  alert: file("cat-alert.png")
};

/** Five sitting frames, left to right. Breathing only. */
export const CAT_BREATHE = file("cat-breathe.png");
export const CAT_BREATHE_FRAMES = 5;

const ROBOT_IDLE = "robot-idle.png";

function fileName(path: string) {
  return (path.split(/[/\\]/).pop() ?? path).toLowerCase();
}

/** True when the idle robot is present. Walk, alert and sleep are optional. */
export function hasRobotFrames(paths: readonly string[]) {
  return paths.some((path) => fileName(path) === ROBOT_IDLE);
}

/** `robot-walk.png`, then `robot-walk-2.png` and the rest in order. */
export function robotWalkPaths(paths: readonly string[]) {
  return paths
    .map((path) => {
      const match = /^robot-walk(?:-(\d+))?\.png$/i.exec(fileName(path));
      if (!match) return null;
      return { path, order: match[1] ? Number(match[1]) : 1 };
    })
    .filter((item): item is { path: string; order: number } => item != null)
    .sort((a, b) => a.order - b.order)
    .map((item) => item.path);
}

export function robotPoseSrc(pose: MascotPose, files: Record<string, string>) {
  const find = (name: string) => {
    const key = Object.keys(files).find((path) => fileName(path) === name);
    return key ? files[key] : "";
  };
  const idle = find(ROBOT_IDLE);
  if (pose === "alert") return { src: find("robot-alert.png") || idle, frames: [] as string[] };
  if (pose === "sit") {
    const frames = robotWalkPaths(Object.keys(files))
      .map((path) => files[path])
      .filter((src) => src.length > 0);
    if (frames.length) return { src: frames[0], frames };
    return { src: idle, frames: [] as string[] };
  }
  return { src: idle || find("robot-sleep.png"), frames: [] as string[] };
}

/** Alert when any visible slot is waiting or finished. Sit while any is working. Sleep when every slot is idle. */
export function mascotPose(
  slots: { id: string }[],
  activities: ProviderActivity[],
  finished?: ReadonlySet<string>
): MascotPose {
  let working = false;
  for (const slot of slots) {
    const activity = activityForSlot(activities, slot.id);
    if (activity?.state === "waiting" || finished?.has(slot.id)) return "alert";
    if (activity?.state === "working") working = true;
  }
  return working ? "sit" : "sleep";
}

export type MascotNoticeKind = "question" | "permission" | "done";

export type MascotNotice = {
  slotId: string;
  name: string;
  kind: MascotNoticeKind;
};

const FAMILY: Record<string, string> = {
  gemini: "Gemini",
  "claude-gpt": "Claude + GPT",
  argon: "Argon"
};

const POOL_SLOT = /^(antigravity(?:-\d+)?)-(gemini|gpt|argon)$/;

/** The dock's own name. An Antigravity pool that is not already in that name is added. */
export function mascotNoticeName(slot: { id: string; name: string }, pool?: string | null) {
  if (POOL_SLOT.test(slot.id) || !pool || !FAMILY[pool]) return slot.name;
  const family = FAMILY[pool];
  if (slot.name === family || slot.name.startsWith(family + " ")) return slot.name;
  return slot.name + " · " + family;
}

/**
 * One line per slot and kind. Waiting with no reason counts as a question.
 * A conversation that is not waiting and not finished adds nothing.
 */
export function mascotNotices(
  slots: { id: string; name: string }[],
  activities: ProviderActivity[],
  finished?: ReadonlySet<string>
): MascotNotice[] {
  const notices: MascotNotice[] = [];
  const seen = new Set<string>();
  const add = (slotId: string, name: string, kind: MascotNoticeKind) => {
    const key = slotId + "\0" + kind + "\0" + name;
    if (seen.has(key)) return;
    seen.add(key);
    notices.push({ slotId, name, kind });
  };

  for (const slot of slots) {
    const activity = activityForSlot(activities, slot.id);
    if (activity?.state === "waiting") {
      const waiting = activity.sessions.filter((session) => session.state === "waiting");
      const source = waiting.length ? waiting : activity.sessions;
      const pooled = source.some((session) => session.pool);
      const rows = pooled ? source.filter((session) => session.pool) : source;
      if (!rows.length) add(slot.id, slot.name, "question");
      for (const session of rows) {
        const kind = session.reason === "permission" ? "permission" : "question";
        add(slot.id, mascotNoticeName(slot, session.pool), kind);
      }
    }
    if (finished?.has(slot.id)) add(slot.id, mascotNoticeName(slot), "done");
  }
  return notices;
}

/** Permission keeps the bang when a finish is lit on another slot. */
export function mascotBang(notices: readonly MascotNotice[]): "permission" | "done" | null {
  if (notices.some((notice) => notice.kind === "permission")) return "permission";
  if (notices.some((notice) => notice.kind === "done")) return "done";
  return null;
}

export function mascotMarkNotices(notices: readonly MascotNotice[], mark: "question" | "bang") {
  if (mark === "question") return notices.filter((notice) => notice.kind === "question");
  return notices.filter((notice) => notice.kind === "permission" || notice.kind === "done");
}

export function mascotNoticeText(notice: MascotNotice) {
  if (notice.kind === "permission") return t("{name} precisa de permissão", { name: notice.name });
  if (notice.kind === "done") return t("{name} finalizou", { name: notice.name });
  return t("{name} tem uma pergunta", { name: notice.name });
}
