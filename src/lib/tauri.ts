import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { DockSide, MonitorInfo, PromptItem, ProviderSetupStatus, ProviderUsage } from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

function measurePillHeight() {
  const pill = document.querySelector(".dock-pill");
  if (!(pill instanceof HTMLElement)) return 320;
  return Math.ceil(pill.getBoundingClientRect().height) + 20;
}

export async function setDock(
  side: DockSide,
  expanded: boolean,
  monitorIndex: number,
  compactHeight = 320
) {
  if (!isTauri()) return;
  const height = expanded ? 560 : Math.max(compactHeight, measurePillHeight());
  await invoke("set_dock_state", { side, expanded, monitorIndex, compactHeight: height });
}

export async function raiseDock() {
  if (!isTauri()) return;
  await invoke("raise_dock");
}

export async function quitApp() {
  if (!isTauri()) {
    window.close();
    return;
  }
  await invoke("quit_app");
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
  if (!isTauri()) return [];
  return invoke<ProviderUsage[]>("get_provider_usage");
}

export async function fetchClaudeWebStatus(): Promise<ProviderUsage> {
  if (!isTauri()) {
    return { id: "claude", name: "Claude", connected: false, windows: [], error: "Prévia local." };
  }
  return invoke<ProviderUsage>("claude_web_status");
}

export async function saveClaudeWebSession(sessionKey: string): Promise<ProviderUsage> {
  if (!isTauri()) {
    throw new Error("Abra o AI Dock instalado para salvar a sessão.");
  }
  return invoke<ProviderUsage>("set_claude_web_session", { sessionKey });
}

export async function clearClaudeWebSession(): Promise<void> {
  if (!isTauri()) return;
  await invoke("clear_claude_web_session");
}

export async function fetchProviderSetupStatus(): Promise<ProviderSetupStatus> {
  if (!isTauri()) {
    return { installed: false, authenticated: false, version: null, npmAvailable: true, npmManaged: false };
  }
  return invoke<ProviderSetupStatus>("provider_setup_status");
}

export async function installProviderCli(): Promise<ProviderSetupStatus> {
  if (!isTauri()) {
    return { installed: true, authenticated: false, version: "Claude Code", npmAvailable: true, npmManaged: true };
  }
  return invoke<ProviderSetupStatus>("install_provider_cli");
}

export async function uninstallProviderCli(): Promise<ProviderSetupStatus> {
  if (!isTauri()) {
    return { installed: false, authenticated: false, version: null, npmAvailable: true, npmManaged: false };
  }
  return invoke<ProviderSetupStatus>("uninstall_provider_cli");
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
