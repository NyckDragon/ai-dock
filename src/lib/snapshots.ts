import type { ProviderUsage } from "../types";

/**
 * Merges a new reading into the previous one. A provider that fails but had a
 * good reading keeps its bars, marked stale, instead of going blank.
 */
export function mergeProviderSnapshots(
  previous: ProviderUsage[],
  incoming: ProviderUsage[],
  updatedAt: number
): ProviderUsage[] {
  const previousById = new Map(previous.map((provider) => [provider.id, provider]));

  return incoming.map((provider) => {
    const prior = previousById.get(provider.id);

    if (provider.connected && provider.windows.length > 0) {
      return { ...provider, stale: false, updatedAt, lastErrorAt: null };
    }

    if (prior && prior.windows.length > 0) {
      return {
        ...prior,
        connected: provider.connected,
        stale: true,
        error: provider.error || "Falha temporária ao atualizar este provider.",
        lastErrorAt: updatedAt
      };
    }

    return {
      ...provider,
      stale: false,
      updatedAt,
      lastErrorAt: provider.error ? updatedAt : null
    };
  });
}
