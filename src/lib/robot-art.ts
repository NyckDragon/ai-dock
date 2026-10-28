import { hasRobotFrames } from "./mascot";

const modules = import.meta.glob("../../public/mascot/robot-*.png", {
  eager: true,
  import: "default",
  query: "?url"
}) as Record<string, string>;

/** Served robot frames, keyed by their file path. Empty when the drawings are not in public/mascot. */
export const ROBOT_FILES: Record<string, string> = modules;

export const ROBOT_READY = hasRobotFrames(Object.keys(ROBOT_FILES));
