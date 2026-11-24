/** Usage levels with their own switch, like Claude Usage Tracker: yellow, orange, red. */
export const ALERT_LEVELS = [75, 90, 95] as const;
export const CUSTOM_ALERT_MIN = 50;
export const CUSTOM_ALERT_MAX = 99;
export const CUSTOM_ALERT_DEFAULT = 60;

/**
 * Windows toast sounds by name. Without a name the toast is silent, so "silent"
 * simply sends none.
 */
export const ALERT_SOUNDS = ["Default", "Reminder", "IM", "Alarm", "silent"] as const;
export type AlertSound = (typeof ALERT_SOUNDS)[number];
export type AlertTone = "yellow" | "orange" | "red";

/** The levels in use, lowest first, without repeats. */
export function activeAlertLevels(levels: readonly number[], custom: number | null): number[] {
  const all = custom == null ? [...levels] : [...levels, custom];
  return [...new Set(all.filter((level) => level > 0 && level < 100))].sort((a, b) => a - b);
}

/**
 * The highest usage level a window passed between two readings, or null. A
 * jump over several levels sends one notification, for the highest.
 */
export function crossedAlert(beforeRemaining: number, nowRemaining: number, levels: readonly number[]): number | null {
  const before = 100 - beforeRemaining;
  const now = 100 - nowRemaining;
  const crossed = levels.filter((level) => before < level && now >= level);
  return crossed.length ? Math.max(...crossed) : null;
}

/** Dot color of a level: up to 89% yellow, 90–94% orange, 95% and up red. */
export function alertTone(level: number): AlertTone {
  if (level >= 95) return "red";
  if (level >= 90) return "orange";
  return "yellow";
}

/** The name the notification plugin expects, or undefined for no sound. */
export function soundName(sound: AlertSound): string | undefined {
  return sound === "silent" ? undefined : sound;
}

export function clampCustomAlert(value: unknown): number | null {
  if (value == null) return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.max(CUSTOM_ALERT_MIN, Math.min(CUSTOM_ALERT_MAX, number));
}
