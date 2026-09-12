import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DockSide, MonitorInfo, PromptItem, ProviderUsage } from "../types";

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
        connected: true,
        plan: "Max",
        windows: [
          { id: "session", label: "Sessão · 5h", usedPercent: 70 },
          { id: "weekly", label: "Semanal", usedPercent: 42 }
        ]
      },
      {
        id: "codex",
        name: "Codex",
        connected: true,
        plan: "Plus",
        windows: [
          { id: "session", label: "Sessão · 5h", usedPercent: 40 },
          { id: "weekly", label: "Semanal", usedPercent: 21 }
        ]
      }
    ];
  }
  return invoke<ProviderUsage[]>("get_provider_usage");
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
