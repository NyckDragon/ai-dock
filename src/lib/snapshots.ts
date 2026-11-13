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
  const incomingIds = new Set(incoming.map((provider) => provider.id));
  const previousById = new Map(previous.map((provider) => [provider.id, provider]));

  const merged = incoming.map((provider) => {
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

  // An Antigravity account whose window closed keeps its last bars. Any other slot that
  // stops coming is gone on purpose (Grok Bot on the unified X plan, an OpenBot slot
  // folded into the account's own slot) and is not kept.
  const keepsBars = (id: string) => id.startsWith("antigravity") && !id.startsWith("antigravity-openbot");
  for (const prior of previous) {
    if (keepsBars(prior.id) && !incomingIds.has(prior.id) && prior.windows.length > 0) {
      merged.push({
        ...prior,
        connected: false,
        stale: true,
        error: "Aplicativo fechado",
        lastErrorAt: updatedAt
      });
    }
  }

  return merged;
}
