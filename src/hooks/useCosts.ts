import { useCallback, useEffect, useState } from "react";
import { fetchLocalCosts } from "../lib/tauri";
import type { CostReport } from "../types";

const REFRESH_MS = 5 * 60 * 1000;

/** Local cost report for the last `days` days, read while the costs view is open. */
export function useCosts(active: boolean, days: number) {
  const [report, setReport] = useState<CostReport | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await fetchLocalCosts(days));
    } catch {
      setReport({ entries: [], prices: "none", files: 0 });
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (!active) return;
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  return { report, loading, reload: load };
}
