import { useCallback, useEffect, useRef, useState } from "react";
import { activityForSlot } from "../lib/quota";
import { clearFinish, IDLE_TRACK, stepFinish, type FinishTrack } from "../lib/finish";
import type { ProviderActivity } from "../types";

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) return false;
  for (const id of left) if (!right.has(id)) return false;
  return true;
}

/** Per-slot "finished" light. It is not an activity the backend reports. */
export function useFinishSignal(activities: ProviderActivity[], slotIds: string[]) {
  const tracks = useRef(new Map<string, FinishTrack>());
  const activitiesRef = useRef(activities);
  const slotIdsRef = useRef(slotIds);
  activitiesRef.current = activities;
  slotIdsRef.current = slotIds;
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set());

  const publish = useCallback((now: number) => {
    const ids = new Set(slotIdsRef.current);
    for (const id of tracks.current.keys()) {
      if (!ids.has(id)) tracks.current.delete(id);
    }
    const nextDone = new Set<string>();
    for (const id of ids) {
      const activity = activityForSlot(activitiesRef.current, id);
      const state = activity?.state === "working" || activity?.state === "waiting" ? activity.state : "idle";
      const prev = tracks.current.get(id) ?? IDLE_TRACK;
      const next = stepFinish(prev, state, now);
      if (next !== prev) tracks.current.set(id, next);
      if (next.phase === "done") nextDone.add(id);
    }
    setDone((current) => (sameIds(current, nextDone) ? current : nextDone));
  }, []);

  useEffect(() => {
    publish(Date.now());
  }, [activities, slotIds, publish]);

  useEffect(() => {
    const timer = window.setInterval(() => publish(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [publish]);

  const dismiss = useCallback(() => {
    for (const [id, track] of tracks.current) {
      const next = clearFinish(track);
      if (next !== track) tracks.current.set(id, next);
    }
    setDone((current) => (current.size === 0 ? current : new Set()));
  }, []);

  return { done, dismiss };
}
