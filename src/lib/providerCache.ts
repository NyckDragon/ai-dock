import type { ProviderUsage } from "../types";
import { readJson, writeJson } from "./storage";

const STORAGE_PROVIDER_CACHE = "ai-dock-provider-cache";

/** Last good readings from the previous run, shown as stale until the first refresh. */
export function loadProviderCache(): ProviderUsage[] {
  const parsed = readJson<unknown>(STORAGE_PROVIDER_CACHE, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (provider): provider is ProviderUsage =>
        Boolean(provider) && typeof provider.id === "string" && Array.isArray(provider.windows)
    )
    .map((provider) => ({
      ...provider,
      connected: false,
      stale: provider.windows.length > 0,
      error: provider.windows.length > 0 ? "Mostrando a última leitura salva enquanto atualizo." : provider.error
    }));
}

/** Stores quota metadata only: no credential ever reaches this cache. */
export function saveProviderCache(providers: ProviderUsage[]) {
  const cacheable = providers
    .filter((provider) => provider.windows.length > 0)
    .map(({ error: _error, lastErrorAt: _lastErrorAt, ...provider }) => provider);
  writeJson(STORAGE_PROVIDER_CACHE, cacheable);
}
