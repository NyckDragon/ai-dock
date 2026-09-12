export type DockSide = "left" | "right";

export type UsageWindow = {
  id: string;
  label: string;
  usedPercent: number;
  resetAt?: string | null;
};

export type ProviderUsage = {
  id: "claude" | "codex" | string;
  name: string;
  connected: boolean;
  plan?: string | null;
  windows: UsageWindow[];
  error?: string | null;
};

export type PromptItem = {
  path: string;
  title: string;
  category?: string | null;
  tags: string[];
  favorite: boolean;
  content: string;
};
