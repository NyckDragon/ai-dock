import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { KoraEvent } from "./contracts";

export const KORA_EVENT_CHANNEL = "kora:event";

export async function onKoraEvent(handler: (event: KoraEvent) => void): Promise<UnlistenFn> {
  return listen<KoraEvent>(KORA_EVENT_CHANNEL, (event) => handler(event.payload));
}
