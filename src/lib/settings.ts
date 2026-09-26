import type { CompactMode, Settings } from "../types";
import { readJson, readRaw, removeKeys, writeJson } from "./storage";

const STORAGE_SETTINGS = "ai-dock-settings";

// Keys used up to v0.4.1. Read once, then folded into STORAGE_SETTINGS.
const LEGACY = {
  side: "ai-dock-side",
  monitor: "ai-dock-monitor-index",
  obsidian: "ai-dock-obsidian-path",
  compactMode: "ai-dock-compact-mode",
  compactSign: "ai-dock-compact-sign"
};

export const PROVIDER_IDS = ["claude", "codex", "cursor", "antigravity"];
export const REFRESH_CHOICES = [1, 2, 5, 10, 15];
const SETTINGS_VERSION = 2;
export const GLOBAL_SHORTCUT = "CommandOrControl+Alt+Space";
export const GLOBAL_SHORTCUT_LABEL = "Ctrl + Alt + Espaço";

export const DEFAULT_SETTINGS: Settings = {
  side: "right",
  monitorIndex: 0,
  verticalOffset: 0,
  compactMode: "ring",
  showSign: true,
  display: "native",
  theme: "system",
  autoHide: false,
  closeOnBlur: true,
  hideOnFullscreen: true,
  refreshMinutes: 5,
  globalShortcut: true,
  autoPaste: false,
  notifyLowQuota: true,
  notifyReset: true,
  notifyWaiting: true,
  providerOrder: PROVIDER_IDS,
  hiddenProviders: [],
  obsidianPath: null,
  onboarded: false,
  settingsVersion: SETTINGS_VERSION
};

const COMPACT_MODES: CompactMode[] = ["classic", "percent", "ring", "square"];

function legacySettings(): Partial<Settings> | null {
  const values = Object.values(LEGACY).map(readRaw);
  if (values.every((value) => value == null)) return null;

  const legacy: Partial<Settings> = { onboarded: true };
  const side = readRaw(LEGACY.side);
  if (side === "left" || side === "right") legacy.side = side;
  const monitor = Number(readRaw(LEGACY.monitor));
  if (Number.isInteger(monitor) && monitor >= 0) legacy.monitorIndex = monitor;
  const obsidian = readRaw(LEGACY.obsidian);
  if (obsidian) legacy.obsidianPath = obsidian;
  const mode = readRaw(LEGACY.compactMode);
  if (mode === "ring-percent") legacy.compactMode = "ring";
  else if (COMPACT_MODES.includes(mode as CompactMode)) legacy.compactMode = mode as CompactMode;
  else legacy.compactMode = "classic";
  if (readRaw(LEGACY.compactSign) === "off") legacy.showSign = false;
  return legacy;
}

function normalize(value: Partial<Settings>): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...value };
  // v2: Claude shows "% usado" like claude.ai. v0.5.0 only offered remaining/used and
  // defaulted to remaining, so that default moves to the per-product one.
  if ((value.settingsVersion || 1) < 2 && merged.display === "remaining") merged.display = "native";
  merged.settingsVersion = SETTINGS_VERSION;
  const known = merged.providerOrder.filter((id) => PROVIDER_IDS.includes(id));
  return {
    ...merged,
    compactMode: COMPACT_MODES.includes(merged.compactMode) ? merged.compactMode : DEFAULT_SETTINGS.compactMode,
    verticalOffset: Math.max(-45, Math.min(45, Number(merged.verticalOffset) || 0)),
    refreshMinutes: REFRESH_CHOICES.includes(merged.refreshMinutes) ? merged.refreshMinutes : 5,
    providerOrder: [...known, ...PROVIDER_IDS.filter((id) => !known.includes(id))],
    hiddenProviders: merged.hiddenProviders.filter((id) => PROVIDER_IDS.includes(id))
  };
}

export function loadSettings(): Settings {
  const stored = readJson<Partial<Settings> | null>(STORAGE_SETTINGS, null);
  if (stored) {
    const settings = normalize(stored);
    if (stored.settingsVersion !== settings.settingsVersion) writeJson(STORAGE_SETTINGS, settings);
    return settings;
  }

  const legacy = legacySettings();
  const settings = normalize(legacy || {});
  if (legacy) {
    writeJson(STORAGE_SETTINGS, settings);
    removeKeys(Object.values(LEGACY));
  }
  return settings;
}

export function saveSettings(settings: Settings) {
  writeJson(STORAGE_SETTINGS, settings);
}
