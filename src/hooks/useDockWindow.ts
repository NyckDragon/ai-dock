import { useCallback, useEffect, useRef, useState } from "react";
import { setDock } from "../lib/tauri";
import type { DockMode, Settings } from "../types";

export type PeekPhase = "closed" | "opening" | "open" | "closing";

const PEEK_EXTRA = 180;
const PEEK_MIN = 420;
const PEEK_CLOSE_MS = 170;
const HIDE_DELAY_MS = 700;
const HIDE_AFTER_START_MS = 2500;

/**
 * Owns the native window: its size for each state, the hover peek and auto-hide.
 *
 * The pill is measured with a ResizeObserver, and Rust anchors the window top to
 * it, so growing the window for the peek never moves the pill on screen. All
 * native calls go through one queue so resizes never race each other.
 */
export function useDockWindow(settings: Settings, expanded: boolean) {
  const [pillHeight, setPillHeight] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekPhase, setPeekPhase] = useState<PeekPhase>("closed");

  const anchorHeight = (pillHeight || 280) + 20;
  const placementRef = useRef({ settings, anchorHeight });
  placementRef.current = { settings, anchorHeight };

  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const peekNativeRef = useRef(false);
  const peekTargetRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const observerRef = useRef<ResizeObserver | null>(null);

  const place = useCallback((mode: DockMode) => {
    const { settings: current, anchorHeight: anchor } = placementRef.current;
    const height = mode === "peek" ? Math.max(anchor + PEEK_EXTRA, PEEK_MIN) : anchor;
    const run = () =>
      setDock({
        side: current.side,
        mode,
        monitorIndex: current.monitorIndex,
        height,
        anchorHeight: anchor,
        verticalOffset: current.verticalOffset
      });
    const next = queueRef.current.then(run, run);
    queueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  const pillRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const measure = () => {
      const height = Math.ceil(node.getBoundingClientRect().height);
      if (height > 0) setPillHeight(height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const resetPeek = useCallback(() => {
    clearCloseTimer();
    peekTargetRef.current = null;
    peekNativeRef.current = false;
    setPeekId(null);
    setPeekPhase("closed");
  }, [clearCloseTimer]);

  // Every change of state or placement settings re-places the window.
  useEffect(() => {
    if (expanded) {
      resetPeek();
      if (hidden) setHidden(false);
    }
    const mode: DockMode = expanded ? "expanded" : hidden ? "hidden" : peekNativeRef.current ? "peek" : "compact";
    void place(mode);
  }, [
    expanded,
    hidden,
    settings.side,
    settings.monitorIndex,
    settings.verticalOffset,
    anchorHeight,
    place,
    resetPeek
  ]);

  const openPeek = useCallback(
    async (slotId: string) => {
      if (expanded) return;
      clearCloseTimer();
      peekTargetRef.current = slotId;

      if (peekNativeRef.current) {
        setPeekId(slotId);
        setPeekPhase("open");
        return;
      }

      peekNativeRef.current = true;
      setPeekPhase("opening");
      try {
        // Grow the native window first so the card never paints clipped.
        await place("peek");
        const target = peekTargetRef.current;
        if (!target) {
          peekNativeRef.current = false;
          await place("compact");
          setPeekPhase("closed");
          return;
        }
        setPeekId(target);
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setPeekPhase("open")));
      } catch {
        resetPeek();
      }
    },
    [expanded, clearCloseTimer, place, resetPeek]
  );

  const closePeek = useCallback(() => {
    clearCloseTimer();
    peekTargetRef.current = null;
    if (!peekNativeRef.current) {
      setPeekId(null);
      setPeekPhase("closed");
      return;
    }
    setPeekPhase("closing");
    closeTimerRef.current = window.setTimeout(() => {
      setPeekId(null);
      void place("compact").finally(() => {
        peekNativeRef.current = false;
        setPeekPhase("closed");
      });
    }, PEEK_CLOSE_MS);
  }, [clearCloseTimer, place]);

  const scheduleHide = useCallback(
    (delay = HIDE_DELAY_MS) => {
      clearHideTimer();
      if (!settings.autoHide || expanded) return;
      hideTimerRef.current = window.setTimeout(() => {
        if (!hoverRef.current && !peekNativeRef.current) setHidden(true);
      }, delay);
    },
    [settings.autoHide, expanded, clearHideTimer]
  );

  useEffect(() => {
    if (!settings.autoHide) {
      clearHideTimer();
      setHidden(false);
    } else if (!expanded) {
      scheduleHide(HIDE_AFTER_START_MS);
    }
    return clearHideTimer;
  }, [settings.autoHide, expanded, scheduleHide, clearHideTimer]);

  const onShellEnter = useCallback(() => {
    hoverRef.current = true;
    clearHideTimer();
    setHidden(false);
  }, [clearHideTimer]);

  const onShellLeave = useCallback(() => {
    hoverRef.current = false;
    closePeek();
    scheduleHide();
  }, [closePeek, scheduleHide]);

  return {
    pillRef,
    anchorHeight,
    hidden,
    peekId,
    peekPhase,
    openPeek,
    closePeek,
    clearCloseTimer,
    resetPeek,
    onShellEnter,
    onShellLeave
  };
}
