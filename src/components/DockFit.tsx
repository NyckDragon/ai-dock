import { useLayoutEffect } from "react";
import { setDock } from "../lib/tauri";
import type { CompactMode, DockSide } from "../types";

function measurePill() {
  const pill = document.querySelector(".dock-pill");
  if (!(pill instanceof HTMLElement)) return 320;
  return Math.ceil(pill.getBoundingClientRect().height) + 20;
}

export function DockFit({
  side,
  expanded,
  monitorIndex,
  compactMode
}: {
  side: DockSide;
  expanded: boolean;
  monitorIndex: number;
  compactMode: CompactMode;
}) {
  useLayoutEffect(() => {
    let alive = true;

    const apply = (height: number) => {
      if (!alive) return;
      void setDock(side, expanded, monitorIndex, height);
    };

    apply(expanded ? 560 : measurePill());
    const t1 = window.setTimeout(() => apply(expanded ? 560 : measurePill()), 80);
    const t2 = window.setTimeout(() => apply(expanded ? 560 : measurePill()), 280);
    const t3 = window.setTimeout(() => apply(expanded ? 560 : measurePill()), 700);

    return () => {
      alive = false;
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [side, expanded, monitorIndex, compactMode]);

  return null;
}
