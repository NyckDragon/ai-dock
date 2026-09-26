import { useCallback, useEffect, useRef, useState } from "react";
import { loadHistory, recordHistory, type UsageHistory } from "../lib/history";
import { loadProviderCache, saveProviderCache } from "../lib/providerCache";
import { mergeProviderSnapshots } from "../lib/snapshots";
import { fetchUsage } from "../lib/tauri";
import type { ProviderUsage } from "../types";

const MAX_BACKOFF = 4;
/** Background triggers (focus, hover, reconnect) never refresh more often than this. */
const MIN_REFRESH_GAP_MS = 10_000;
/** Refresh this long after a known reset, so the renewed quota shows up right away. */
const RESET_GRACE_MS = 3_500;
const MAX_RESET_TIMER_MS = 12 * 60 * 60_000;

function rateLimited(providers: ProviderUsage[]) {
  return providers.some((provider) => /429|limitou|cloudflare/i.test(provider.error || ""));
}

export type RefreshOptions = {
  /** Skips the spinner; used by timers and focus. */
  background?: boolean;
  /** Ignores the minimum gap; used by the refresh button and resets. */
  force?: boolean;
};

/**
 * Loads quota on start and keeps it fresh: on the chosen interval, right after
 * a known reset, when the window regains focus and when the network comes back.
 * A failed provider keeps its last good reading, marked stale. A failed or
 * rate-limited round doubles the wait, up to 4x, until a clean one.
 */
export function useProviders(refreshMinutes: number) {
  const [providers, setProviders] = useState<ProviderUsage[]>(loadProviderCache);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<UsageHistory>(loadHistory);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const lastStartRef = useRef(0);
  const backoffRef = useRef(1);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef(refreshMinutes);
  intervalRef.current = refreshMinutes;

  const schedule = useCallback((run: () => void) => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(run, intervalRef.current * 60000 * backoffRef.current);
  }, []);

  const refreshRef = useRef<(options?: RefreshOptions) => Promise<void>>(async () => undefined);

  const refresh = useCallback(
    (options: RefreshOptions = {}) => {
      if (inFlightRef.current) return inFlightRef.current;
      const startedAt = Date.now();
      if (!options.force && startedAt - lastStartRef.current < MIN_REFRESH_GAP_MS) return Promise.resolve();
      lastStartRef.current = startedAt;
      if (!options.background) setLoading(true);

      const job = (async () => {
        try {
          const next = await fetchUsage();
          const updatedAt = Date.now();
          setProviders((current) => {
            const merged = mergeProviderSnapshots(current, next, updatedAt);
            saveProviderCache(merged);
            return merged;
          });
          setLastUpdatedAt(updatedAt);
          setFailed(false);
          setHistory((current) => recordHistory(current, next));
          backoffRef.current = rateLimited(next) ? Math.min(MAX_BACKOFF, backoffRef.current * 2) : 1;
        } catch {
          setFailed(true);
          backoffRef.current = Math.min(MAX_BACKOFF, backoffRef.current * 2);
          setProviders((current) =>
            current.map((provider) =>
              provider.windows.length ? { ...provider, stale: true, lastErrorAt: Date.now() } : provider
            )
          );
        } finally {
          inFlightRef.current = null;
          setLoading(false);
          schedule(() => void refreshRef.current({ background: true, force: true }));
        }
      })();

      inFlightRef.current = job;
      return job;
    },
    [schedule]
  );
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh({ force: true });
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  // A new interval takes effect right away instead of after the old wait.
  useEffect(() => {
    if (!inFlightRef.current && lastUpdatedAt != null) {
      schedule(() => void refreshRef.current({ background: true, force: true }));
    }
  }, [refreshMinutes]);

  // Coming back to the dock or back online refreshes without waiting for the timer.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshRef.current({ background: true });
    };
    const onOnline = () => void refreshRef.current({ background: true, force: true });
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Right after the nearest known reset, read again so the renewed quota appears.
  useEffect(() => {
    const now = Date.now();
    const resets = providers
      .flatMap((provider) => provider.windows)
      .map((window) => (window.resetAt ? Date.parse(window.resetAt) : Number.NaN))
      .filter((time) => Number.isFinite(time) && time > now);
    if (!resets.length) return;
    const delay = Math.min(MAX_RESET_TIMER_MS, Math.max(1_000, Math.min(...resets) - now + RESET_GRACE_MS));
    const timer = window.setTimeout(() => void refreshRef.current({ background: true, force: true }), delay);
    return () => window.clearTimeout(timer);
  }, [providers]);

  return { providers, loading, lastUpdatedAt, failed, history, refresh };
}
