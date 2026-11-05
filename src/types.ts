export type DockSide = "left" | "right";
export type CompactMode = "classic" | "percent" | "ring" | "square" | "bars";
export type ThemePreference = "system" | "dark" | "light";
/** "native" follows each product: Claude shows what was used, the others what is left. */
export type PercentDisplay = "native" | "remaining" | "used";
/** Which usage window the dock and the card headline show. */
export type HeadlineWindow = "session" | "limiting";
export type DockMode = "compact" | "peek" | "hidden" | "expanded";
export type SettingsTab = "appearance" | "position" | "general" | "connections";
export type PanelView = "usage" | "costs" | "prompts";
export type Language = "auto" | "pt" | "en";
export type HistoryRange = "24h" | "7d" | "30d";
export type AntigravityGroupMode = "bars" | "rings" | "split";

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
  /** Currency figure exactly as an official balance API spelled it. Not a percentage. */
  amount?: string | null;
};

export type ProviderUsage = {
  id: "claude" | "codex" | "cursor" | "antigravity" | string;
  name: string;
  connected: boolean;
  plan?: string | null;
  email?: string | null;
  windows: UsageWindow[];
  error?: string | null;
  /** True when the windows are the last good reading, kept after a failed refresh. */
  stale?: boolean;
  updatedAt?: number | null;
  lastErrorAt?: number | null;
};

export type StatusLevel = "none" | "maintenance" | "minor" | "major" | "critical";

export type ProviderStatus = {
  providerId: string;
  level: StatusLevel;
  summary?: string | null;
  url: string;
};

export type CostEntry = {
  date: string;
  provider: "claude" | "codex" | string;
  model: string;
  project: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  costUsd: number | null;
};

export type CostReport = {
  entries: CostEntry[];
  prices: "online" | "cached" | "none";
  files: number;
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
export type ActivityIndicator = "sweep" | "pulse" | "solid" | "none";
export type ActivityConfidence = "direct" | "inferred";

export type ActivitySession = {
  id: string;
  title: string;
  detail: string;
  state: ActivityState;
  since: number;
  /** Antigravity quota pool, when the running model is known. */
  pool?: "gemini" | "claude-gpt" | "argon";
  /** Why a session is waiting. Absent waiting keeps the question color. */
  reason?: "permission" | "question" | null;
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
  /** #RRGGBB override. Null keeps the theme token. */
  questionColor: string | null;
  /** #RRGGBB override. Null keeps the theme token. */
  permissionColor: string | null;
  /** #RRGGBB override. Null keeps the theme token. */
  doneColor: string | null;
  /** Pixel cat on the collapsed pill. Off drops the extra window height. */
  mascotEnabled: boolean;
  /** Which drawing sits on the pill. Robot falls back to the cat when its frames are missing. */
  mascot: "cat" | "robot";
  /** Translucent pill. Off keeps the solid theme background. */
  glassEnabled: boolean;
  /** Glass fill, 0 solid through 100 clearest. Ignored while glass is off. */
  glassOpacity: number;
  autoHide: boolean;
  closeOnBlur: boolean;
  hideOnFullscreen: boolean;
  refreshMinutes: number;
  globalShortcut: boolean;
  autoPaste: boolean;
  notifyLowQuota: boolean;
  notifyReset: boolean;
  notifyWaiting: boolean;
  notifyIncidents: boolean;
  notifyFailures: boolean;
  /** Epoch ms until which notifications stay silent; null when active. */
  notificationsPausedUntil: number | null;
  language: Language;
  historyRange: HistoryRange;
  antigravityGroupMode: AntigravityGroupMode;
  activityIndicator: ActivityIndicator;
  pulseActiveBar: boolean;
  hideBarsNumber: boolean;
  lockPosition: boolean;
  providerAliases: Record<string, string>;
  providerOrder: string[];
  hiddenProviders: string[];
  obsidianPath: string | null;
  onboarded: boolean;
  /** Bumped when a default changes and stored settings need a one-time migration. */
  settingsVersion: number;
};
