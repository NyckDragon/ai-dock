export type DockSide = "left" | "right";
export type CompactMode = "classic" | "percent" | "ring" | "ring-percent";

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
  id: "claude" | "codex" | "antigravity" | string;
  name: string;
  connected: boolean;
  plan?: string | null;
  windows: UsageWindow[];
  error?: string | null;
};

export type ProviderSetupStatus = {
  installed: boolean;
  authenticated: boolean;
  version?: string | null;
};

export type PromptItem = {
  path: string;
  title: string;
  category?: string | null;
  tags: string[];
  favorite: boolean;
  content: string;
};
