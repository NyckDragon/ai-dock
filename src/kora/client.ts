import { invoke } from "@tauri-apps/api/core";
import type { KoraJob, KoraStatus, KoraTask } from "./contracts";

export async function getKoraStatus(): Promise<KoraStatus> {
  return invoke<KoraStatus>("kora_status");
}

export async function listKoraJobs(): Promise<KoraJob[]> {
  return invoke<KoraJob[]>("kora_list_jobs");
}

export async function listKoraTasks(): Promise<KoraTask[]> {
  return invoke<KoraTask[]>("kora_list_tasks");
}
