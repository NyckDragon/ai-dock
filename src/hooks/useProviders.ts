import { useCallback, useEffect, useRef, useState } from "react";
import { loadHistory, recordHistory, type UsageHistory } from "../lib/history";
import { fetchUsage } from "../lib/tauri";
import type { ProviderUsage } from "../types";

const MAX_BACKOFF = 4;

function rateLimited(providers: ProviderUsage[]) {
  return providers.some((provider) => /429|limitou/i.test(provider.error || ""));
}

/**
 * Loads quota on start and keeps it fresh on the chosen interval.
 * A failed or rate-limited round doubles the wait, up to 4x, until a clean one.
 */
export function useProviders(refreshMinutes: number) {
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [history, setHistory] = useState<UsageHistory>(loadHistory);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const busyRef = useRef(false);
  const backoffRef = useRef(1);
  const timerRef = useRef<number | null>(null);
  const intervalRef = useRef(refreshMinutes);
  intervalRef.current = refreshMinutes;

  const schedule = useCallback((run: () => void) => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    const delay = intervalRef.current * 60000 * backoffRef.current;
    setNextRefreshAt(Date.now() + delay);
    timerRef.current = window.setTimeout(run, delay);
  }, []);

  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setLoading(true);
    try {
      const next = await fetchUsage();
      setProviders(next);
      setLastUpdatedAt(Date.now());
      setFailed(false);
      setHistory((current) => recordHistory(current, next));
      backoffRef.current = rateLimited(next) ? Math.min(MAX_BACKOFF, backoffRef.current * 2) : 1;
    } catch {
      setFailed(true);
      backoffRef.current = Math.min(MAX_BACKOFF, backoffRef.current * 2);
    } finally {
      busyRef.current = false;
      setLoading(false);
      schedule(() => void refreshRef.current());
    }
  }, [schedule]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refresh();
    return () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    };
  }, [refresh]);

  // A new interval takes effect right away instead of after the old wait.
  useEffect(() => {
    if (!busyRef.current && lastUpdatedAt != null) schedule(() => void refreshRef.current());
  }, [refreshMinutes]);

  return { providers, loading, lastUpdatedAt, failed, history, nextRefreshAt, refresh };
}
