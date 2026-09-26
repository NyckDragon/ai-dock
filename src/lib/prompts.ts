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

const VARIABLE = /\{\{\s*([^{}|]+?)\s*(?:\|\s*([^{}]*?)\s*)?\}\}/g;

export type PromptVariable = { name: string; fallback: string };

/** Finds `{{nome}}` and `{{nome|valor padrão}}` placeholders, once each. */
export function promptVariables(content: string): PromptVariable[] {
  const seen = new Map<string, PromptVariable>();
  for (const match of content.matchAll(VARIABLE)) {
    const name = match[1].trim();
    if (!seen.has(name)) seen.set(name, { name, fallback: match[2]?.trim() || "" });
  }
  return [...seen.values()];
}

export function fillPrompt(content: string, values: Record<string, string>) {
  return content.replace(VARIABLE, (_, rawName: string, fallback?: string) => {
    const name = rawName.trim();
    const value = values[name];
    return value != null && value !== "" ? value : fallback?.trim() || "";
  });
}

export function promptPreview(content: string) {
  return content.replace(/\s+/g, " ").trim().slice(0, 110);
}
