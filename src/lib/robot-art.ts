import { hasRobotFrames } from "./mascot";

/**
 * The robot is unfinished, so releases ship with the cat only. A local build
 * shows the robot choice with `VITE_MASCOT_ROBOT=on` in `.env.local`.
 */
export const ROBOT_ENABLED = import.meta.env.VITE_MASCOT_ROBOT === "on";

const modules = import.meta.glob("../../public/mascot/robot-*.png", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Served robot frames, keyed by their file path. Empty when the robot is off or its drawings are missing. */
export const ROBOT_FILES: Record<string, string> = ROBOT_ENABLED ? modules : {};

export const ROBOT_READY = hasRobotFrames(Object.keys(ROBOT_FILES));
