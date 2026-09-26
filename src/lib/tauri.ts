import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  DockMode,
  DockSide,
  MonitorInfo,
  PromptItem,
  ProviderActivity,
  ProviderSetupStatus,
  ProviderUsage
} from "../types";

export const isTauri = () => "__TAURI_INTERNALS__" in window;

export type DockPlacement = {
  side: DockSide;
  mode: DockMode;
  monitorIndex: number;
  /** Logical height of the native window. */
  height: number;
  /** Logical height of the visible pill; the window top is anchored to it. */
  anchorHeight: number;
  verticalOffset: number;
};

export async function setDock(placement: DockPlacement) {
  if (!isTauri()) return;
  await invoke("set_dock_state", { ...placement });
}

/** Keeps the dock on top. Resolves true when it was hidden for a full-screen app. */
export async function raiseDock(hideOnFullscreen: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("raise_dock", { hideOnFullscreen });
}

export async function focusDock() {
  if (!isTauri()) return;
  await invoke("focus_dock");
}

/** Remembers the app in front, so focus can go back to it after a prompt is copied. */
export async function rememberForeground() {
  if (!isTauri()) return;
  await invoke("remember_foreground");
}

/** Gives focus back to the remembered app and, when asked, pastes the clipboard into it. */
export async function returnFocus(paste: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  return invoke<boolean>("return_focus", { paste });
}

export async function setTrayTooltip(text: string) {
  if (!isTauri()) return;
  await invoke("set_tray_tooltip", { text });
}

export async function onTrayAction(handler: (action: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => undefined;
  return listen<string>("tray-action", (event) => handler(event.payload));
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

export async function fetchActivity(): Promise<ProviderActivity[]> {
  if (!isTauri()) return [];
  return invoke<ProviderActivity[]>("get_provider_activity");
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
