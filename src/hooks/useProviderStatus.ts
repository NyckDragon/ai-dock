import { useEffect, useState } from "react";
import { fetchProviderStatus } from "../lib/tauri";
import type { ProviderStatus } from "../types";

const POLL_MS = 5 * 60 * 1000;

/** Official status-page state per provider, read every 5 min. */
export function useProviderStatus() {
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetchProviderStatus()
        .then((next) => {
          if (alive) setStatuses(next);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(load, POLL_MS);
    window.addEventListener("online", load);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("online", load);
    };
  }, []);

  return statuses;
}

/** Status for a dock slot or card; Antigravity slots have none. */
export function statusFor(statuses: ProviderStatus[], providerId: string) {
  const status = statuses.find((item) => item.providerId === providerId);
  return status && status.level !== "none" ? status : undefined;
}
