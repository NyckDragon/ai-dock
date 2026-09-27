import { readJson, writeJson } from "./storage";

const STORAGE_PROMPT_USAGE = "ai-dock-prompt-usage";

export type PromptUsage = Record<string, { count: number; lastUsed: number }>;

export function loadPromptUsage(): PromptUsage {
  return readJson<PromptUsage>(STORAGE_PROMPT_USAGE, {});
}

export function recordPromptUse(usage: PromptUsage, path: string): PromptUsage {
  const current = usage[path];
  const next = { ...usage, [path]: { count: (current?.count || 0) + 1, lastUsed: Date.now() } };
  writeJson(STORAGE_PROMPT_USAGE, next);
  return next;
}
