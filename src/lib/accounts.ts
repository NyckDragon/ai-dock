import type { ProviderUsage } from "../types";

/**
 * Adds to each Antigravity account the email its launcher bound it to
 * (`.conta_vinculada` in the account folder), so the dock can warn when a
 * window opened with another Google account.
 */
export function withAccountPins(providers: ProviderUsage[], pins: Record<string, string>): ProviderUsage[] {
  return providers.map((provider) => {
    const pin = pins[provider.id];
    return pin ? { ...provider, expectedEmail: pin } : provider;
  });
}

/** The live window is signed in with another account than the one it is bound to. */
export function wrongAccount(provider: ProviderUsage): boolean {
  if (!provider.connected || provider.stale) return false;
  const expected = provider.expectedEmail?.trim().toLowerCase();
  const live = provider.email?.trim().toLowerCase();
  return Boolean(expected && live && expected !== live);
}

export type AccountState = "ok" | "stale" | "wrong" | "error" | "off";

/**
 * The dot of an account in the sidebar: green when it reads fine, red when it
 * is signed in with the wrong account or lost access, amber when the reading is
 * old, gray when it was never connected.
 */
export function accountState(provider: ProviderUsage): AccountState {
  if (wrongAccount(provider)) return "wrong";
  if (provider.stale) return "stale";
  if (provider.connected) return "ok";
  return provider.error ? "error" : "off";
}
