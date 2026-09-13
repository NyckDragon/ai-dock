import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DockSide, MonitorInfo, PromptItem, ProviderSetupStatus, ProviderUsage } from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function setDock(side: DockSide, expanded: boolean, monitorIndex: number) {
  if (!isTauri()) return;
  await invoke("set_dock_state", { side, expanded, monitorIndex });
}

export async function fetchMonitors(): Promise<MonitorInfo[]> {
  if (!isTauri()) {
    return [
      { index: 0, name: "Tela 1", width: 1920, height: 1080, scaleFactor: 1 },
      { index: 1, name: "Tela 2", width: 2560, height: 1440, scaleFactor: 1 }
    ];
  }
  return invoke<MonitorInfo[]>("get_monitors");
}

export async function fetchUsage(): Promise<ProviderUsage[]> {
  if (!isTauri()) {
    return [
      {
        id: "claude",
        name: "Claude",
        connected: false,
        windows: [],
        error: "Claude ainda não conectado."
      },
      {
        id: "codex",
        name: "Codex",
        connected: true,
        plan: "Plus",
        windows: [
          { id: "session", label: "Sessão · 5h", remainingPercent: 60 },
          { id: "weekly", label: "Semanal", remainingPercent: 79 }
        ]
      },
      {
        id: "antigravity",
        name: "Antigravity",
        connected: true,
        plan: "Google AI Pro",
        windows: [
          { id: "gemini-session", label: "Gemini · 5h", remainingPercent: 82 },
          { id: "gemini-weekly", label: "Gemini · semanal", remainingPercent: 68 },
          { id: "third-party-session", label: "Claude + GPT · 5h", remainingPercent: 54 },
          { id: "third-party-weekly", label: "Claude + GPT · semanal", remainingPercent: 74 }
        ]
      }
    ];
  }
  return invoke<ProviderUsage[]>("get_provider_usage");
}

export async function fetchProviderSetupStatus(): Promise<ProviderSetupStatus> {
  if (!isTauri()) {
    return { installed: true, authenticated: false, version: "Claude Code" };
  }
  return invoke<ProviderSetupStatus>("provider_setup_status");
}

export async function openProviderSetup(): Promise<void> {
  if (!isTauri()) return;
  await invoke("open_provider_setup");
}

export async function chooseObsidianFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Selecione o Vault ou a pasta de prompts do Obsidian"
  });
  return typeof selected === "string" ? selected : null;
}

export async function scanPrompts(path: string): Promise<PromptItem[]> {
  if (!isTauri()) return [];
  return invoke<PromptItem[]>("scan_obsidian_prompts", { rootPath: path });
}
