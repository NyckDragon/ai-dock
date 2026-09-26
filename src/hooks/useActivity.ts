import { useEffect, useRef, useState } from "react";
import { fetchActivity } from "../lib/tauri";
import type { ProviderActivity } from "../types";

const FAST_MS = 3000;
const IDLE_MS = 8000;

/** Polls agent activity every 3s while something is running or the panel is open, 8s otherwise. */
export function useActivity(panelOpen: boolean) {
  const [activities, setActivities] = useState<ProviderActivity[]>([]);
  const fastRef = useRef(panelOpen);
  fastRef.current = panelOpen || activities.some((activity) => activity.state !== "idle");

  useEffect(() => {
    let alive = true;
    let timer: number | null = null;

    const tick = async () => {
      try {
        const next = await fetchActivity();
        if (alive) setActivities(next);
      } catch {
        if (alive) setActivities([]);
      }
      if (alive) timer = window.setTimeout(tick, fastRef.current ? FAST_MS : IDLE_MS);
    };

    void tick();
    return () => {
      alive = false;
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  return activities;
}
