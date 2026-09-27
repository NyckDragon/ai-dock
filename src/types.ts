export type DockSide = "left" | "right";
export type CompactMode = "classic" | "percent" | "ring" | "square";
export type ThemePreference = "system" | "dark" | "light";
/** "native" follows each product: Claude shows what was used, the others what is left. */
export type PercentDisplay = "native" | "remaining" | "used";
/** Which usage window the dock and the card headline show. */
export type HeadlineWindow = "session" | "limiting";
export type DockMode = "compact" | "peek" | "hidden" | "expanded";
export type SettingsTab = "appearance" | "position" | "general" | "connections";
export type PanelView = "usage" | "prompts";

export type MonitorInfo = {
  index: number;
  name: string;
  width: number;
  height: number;
  scaleFactor: number;
};

export type UsageWindow = {
  id: string;
  label: string;
  remainingPercent: number;
  resetAt?: string | null;
};

export type ProviderUsage = {
  id: "claude" | "codex" | "cursor" | "antigravity" | string;
  name: string;
  connected: boolean;
  plan?: string | null;
  windows: UsageWindow[];
  error?: string | null;
  /** True when the windows are the last good reading, kept after a failed refresh. */
  stale?: boolean;
  updatedAt?: number | null;
  lastErrorAt?: number | null;
};

export type ProviderSetupStatus = {
  installed: boolean;
  authenticated: boolean;
  version?: string | null;
  npmAvailable: boolean;
  npmManaged?: boolean;
};

export type PromptItem = {
  path: string;
  title: string;
  category?: string | null;
  tags: string[];
  favorite: boolean;
  content: string;
};

export type ActivityState = "working" | "waiting" | "idle";
export type ActivityConfidence = "direct" | "inferred";

export type ActivitySession = {
  id: string;
  title: string;
  detail: string;
  state: ActivityState;
  since: number;
};

export type ProviderActivity = {
  providerId: string;
  state: ActivityState;
  confidence: ActivityConfidence;
  sessions: ActivitySession[];
};

export type Settings = {
  side: DockSide;
  monitorIndex: number;
  /** Percent of the screen height, -45..45. 0 keeps the dock centered. */
  verticalOffset: number;
  compactMode: CompactMode;
  showSign: boolean;
  display: PercentDisplay;
  headline: HeadlineWindow;
  theme: ThemePreference;
  autoHide: boolean;
  closeOnBlur: boolean;
  hideOnFullscreen: boolean;
  refreshMinutes: number;
  globalShortcut: boolean;
  autoPaste: boolean;
  notifyLowQuota: boolean;
  notifyReset: boolean;
  notifyWaiting: boolean;
  providerOrder: string[];
  hiddenProviders: string[];
  obsidianPath: string | null;
  onboarded: boolean;
  /** Bumped when a default changes and stored settings need a one-time migration. */
  settingsVersion: number;
};
