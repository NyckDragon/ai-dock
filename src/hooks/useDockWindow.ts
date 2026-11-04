import { useCallback, useEffect, useRef, useState } from "react";
import { MASCOT_NOTICE_LINE } from "../lib/mascot";
import { setDock, type DockPlacement } from "../lib/tauri";
import type { DockMode, Settings } from "../types";

export type PeekPhase = "closed" | "opening" | "open" | "closing";

export type MascotOverlay = { height: number; width: number };

/** Vertical offsets, in percent, between which dragging still moves the pill. */
export type OffsetRange = { min: number; max: number };

const MAX_OFFSET = 45;

const PEEK_EXTRA = 280;
const PEEK_MIN = 600;
const PEEK_CLOSE_MS = 170;
const HIDE_DELAY_MS = 700;
const HIDE_AFTER_START_MS = 2500;
const LEAVE_GUARD_MS = 200;
const PILL_WIDTH = 58;
const PEEK_WIDTH = 338;
const MASCOT_SIZE = 64;

/** Logical window width, matching `dock_span` in dock.rs. */
function nativeWidth(mode: DockMode, mascot: boolean, overlayWidth: number): number {
  let extra = 0;
  if (mascot && mode !== "expanded" && mode !== "hidden") {
    const overlay = Math.max(0, overlayWidth);
    extra =
      mode === "peek" ? Math.max(0, overlay - PEEK_WIDTH) : Math.max(MASCOT_SIZE - PILL_WIDTH, overlay - PILL_WIDTH);
  }
  if (mode === "expanded") return 380;
  if (mode === "peek") return PEEK_WIDTH + extra;
  if (mode === "hidden") return 12;
  return PILL_WIDTH + extra;
}

function samePlacement(a: DockPlacement, b: DockPlacement): boolean {
  return (
    a.side === b.side &&
    a.mode === b.mode &&
    a.monitorIndex === b.monitorIndex &&
    a.height === b.height &&
    a.anchorHeight === b.anchorHeight &&
    a.verticalOffset === b.verticalOffset &&
    a.mascot === b.mascot &&
    a.overlayHeight === b.overlayHeight &&
    a.overlayWidth === b.overlayWidth
  );
}

/**
 * Owns the native window: its size for each state, the hover peek and auto-hide.
 *
 * A visible, collapsed dock stays at peek width, so showing the card does not
 * move x. One notice line stays reserved above the cat, so showing its label
 * does not move y. set_dock_state runs when that size or the dock position changes.
 * A 1px ResizeObserver flicker does not count. Hover only shows or hides the card.
 */
export function useDockWindow(settings: Settings, expanded: boolean) {
  const [pillHeight, setPillHeight] = useState(0);
  const [pillShift, setPillShift] = useState(0);
  const [offsetRange, setOffsetRange] = useState<OffsetRange>({ min: -MAX_OFFSET, max: MAX_OFFSET });
  const [hidden, setHidden] = useState(false);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [peekPhase, setPeekPhase] = useState<PeekPhase>("closed");
  const peekPhaseRef = useRef<PeekPhase>("closed");
  peekPhaseRef.current = peekPhase;

  const anchorHeight = (pillHeight || 280) + 20;
  const [overlay, setOverlayState] = useState<MascotOverlay>({
    height: settings.mascotEnabled ? MASCOT_NOTICE_LINE : 0,
    width: 0
  });
  const overlayRef = useRef(overlay);
  const placedRef = useRef<Promise<void>>(Promise.resolve());
  const placementRef = useRef({ settings, anchorHeight });
  placementRef.current = { settings, anchorHeight };

  const inFlightRef = useRef(false);
  const pendingModeRef = useRef<DockMode | null>(null);
  const waitersRef = useRef<Array<() => void>>([]);
  const expandedRef = useRef(expanded);
  const hiddenRef = useRef(hidden);
  expandedRef.current = expanded;
  hiddenRef.current = hidden;
  const peekTargetRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const hoverRef = useRef(false);
  const observerRef = useRef<ResizeObserver | null>(null);
  const lastSentRef = useRef<DockPlacement | null>(null);
  const ignoreLeaveUntilRef = useRef(0);

  const place = useCallback((mode: DockMode) => {
    pendingModeRef.current = mode;
    const done = new Promise<void>((resolve) => {
      waitersRef.current.push(resolve);
    });

    const step = async () => {
      try {
        while (pendingModeRef.current != null) {
          const nextMode = pendingModeRef.current;
          pendingModeRef.current = null;
          const { settings: current, anchorHeight: anchor } = placementRef.current;
          const room = current.mascotEnabled ? overlayRef.current : { height: 0, width: 0 };
          // The measured pill is only the bar. dock.rs adds the cat, and the marks above it.
          const height = nextMode === "peek" ? Math.max(anchor + PEEK_EXTRA, PEEK_MIN) : anchor;
          const next: DockPlacement = {
            side: current.side,
            mode: nextMode,
            monitorIndex: current.monitorIndex,
            height,
            anchorHeight: anchor,
            verticalOffset: current.verticalOffset,
            mascot: current.mascotEnabled,
            overlayHeight: room.height,
            overlayWidth: room.width
          };
          const previous = lastSentRef.current;
          if (previous && samePlacement(previous, next)) continue;
          const widening =
            previous != null &&
            nativeWidth(next.mode, next.mascot, next.overlayWidth) >
              nativeWidth(previous.mode, previous.mascot, previous.overlayWidth);
          if (widening) ignoreLeaveUntilRef.current = Number.POSITIVE_INFINITY;
          try {
            const placed = await setDock(next);
            lastSentRef.current = next;
            // Only the visible collapsed dock draws the pill, so only its placement moves it.
            if (placed && next.mode === "peek") {
              const shift = Math.max(0, Math.round(placed.pillShift));
              setPillShift((current) => (current === shift ? current : shift));
              setOffsetRange((current) =>
                current.min === placed.offsetMin && current.max === placed.offsetMax
                  ? current
                  : { min: placed.offsetMin, max: placed.offsetMax }
              );
            }
            if (widening) ignoreLeaveUntilRef.current = performance.now() + LEAVE_GUARD_MS;
          } catch {
            if (widening) ignoreLeaveUntilRef.current = 0;
            /* The next placement replaces a failed one. */
          }
        }
      } finally {
        if (pendingModeRef.current != null) {
          void step();
          return;
        }
        inFlightRef.current = false;
        const waiters = waitersRef.current.splice(0);
        waiters.forEach((resolve) => resolve());
      }
    };

    if (!inFlightRef.current) {
      inFlightRef.current = true;
      void step();
    }
    return done;
  }, []);

  const setOverlay = useCallback((next: MascotOverlay) => {
    const current = overlayRef.current;
    const height = Math.max(0, Math.round(next.height));
    const width = Math.max(0, Math.round(next.width));
    // The same reserved size must not place again. The notice label does not change it.
    if (Math.abs(current.height - height) <= 1 && Math.abs(current.width - width) <= 1) return placedRef.current;
    overlayRef.current = { height, width };
    const mode: DockMode = expandedRef.current ? "expanded" : hiddenRef.current ? "hidden" : "peek";
    const pending = place(mode).then(() => {
      setOverlayState({ height, width });
    });
    placedRef.current = pending;
    return pending;
  }, [place]);

  const pillRef = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const measure = () => {
      // Border box of the pill. The cat and the notice label are absolute and stay out.
      const height = node.offsetHeight;
      if (height <= 0) return;
      setPillHeight((current) => (current > 0 && Math.abs(current - height) <= 1 ? current : height));
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
    setPeekId(null);
    setPeekPhase("closed");
  }, [clearCloseTimer]);

  // Re-place when the mode or the geometry changes. place() does not call the OS again for the same rect.
  useEffect(() => {
    if (expanded) {
      resetPeek();
      if (hidden) setHidden(false);
    }
    if (!settings.mascotEnabled && (overlayRef.current.height !== 0 || overlayRef.current.width !== 0)) {
      overlayRef.current = { height: 0, width: 0 };
      setOverlayState({ height: 0, width: 0 });
    }
    // Visible and collapsed: peek width, once. Hover does not place again.
    const mode: DockMode = expanded ? "expanded" : hidden ? "hidden" : "peek";
    void place(mode);
  }, [
    expanded,
    hidden,
    settings.side,
    settings.monitorIndex,
    settings.verticalOffset,
    settings.mascotEnabled,
    anchorHeight,
    place,
    resetPeek
  ]);

  const openPeek = useCallback(
    (slotId: string) => {
      if (expanded) return;
      clearCloseTimer();
      peekTargetRef.current = slotId;
      setPeekId(slotId);
      if (peekPhaseRef.current === "open") {
        setPeekPhase("open");
        return;
      }
      setPeekPhase("opening");
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => {
          if (peekTargetRef.current !== slotId) return;
          setPeekPhase("open");
        })
      );
    },
    [expanded, clearCloseTimer]
  );

  const closePeek = useCallback(() => {
    clearCloseTimer();
    peekTargetRef.current = null;
    if (peekPhaseRef.current === "closed") {
      setPeekId(null);
      return;
    }
    setPeekPhase("closing");
    closeTimerRef.current = window.setTimeout(() => {
      setPeekId(null);
      setPeekPhase("closed");
    }, PEEK_CLOSE_MS);
  }, [clearCloseTimer]);

  const scheduleHide = useCallback(
    (delay = HIDE_DELAY_MS) => {
      clearHideTimer();
      if (!settings.autoHide || expanded) return;
      hideTimerRef.current = window.setTimeout(() => {
        if (!hoverRef.current) setHidden(true);
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
    // The widen can leave the pointer behind for a frame. That leave must not close the peek.
    if (performance.now() < ignoreLeaveUntilRef.current) return;
    hoverRef.current = false;
    closePeek();
    scheduleHide();
  }, [closePeek, scheduleHide]);

  return {
    pillRef,
    anchorHeight,
    pillShift,
    offsetRange,
    overlay,
    setOverlay,
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
