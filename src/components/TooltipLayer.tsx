import { useEffect, useState } from "react";

const SHOW_DELAY_MS = 450;
const EDGE = 8;
const MAX_WIDTH = 240;

type Tip = { text: string; x: number; y: number; below: boolean };

/**
 * One in-app tooltip for every element with a `title`. The dock is an
 * always-on-top window and Windows draws its own tooltips behind it, so the
 * title moves to `data-tip` on first hover and this layer draws it instead.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer: number | null = null;
    let current: Element | null = null;

    const clear = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
      current = null;
      setTip(null);
    };

    const over = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("[title], [data-tip]") : null;
      if (target === current) return;
      clear();
      if (!target) return;
      // Taking the title off before the system shows it keeps the native tooltip away.
      const title = target.getAttribute("title");
      if (title) {
        target.setAttribute("data-tip", title);
        target.removeAttribute("title");
      }
      const text = target.getAttribute("data-tip");
      if (!text) return;
      current = target;
      timer = window.setTimeout(() => {
        const rect = target.getBoundingClientRect();
        const below = rect.bottom + 40 < window.innerHeight;
        const half = Math.min(MAX_WIDTH, window.innerWidth - EDGE * 2) / 2;
        const x = Math.min(window.innerWidth - EDGE - half, Math.max(EDGE + half, rect.left + rect.width / 2));
        setTip({ text, x, y: below ? rect.bottom + 6 : rect.top - 6, below });
      }, SHOW_DELAY_MS);
    };

    window.addEventListener("mouseover", over);
    window.addEventListener("mousedown", clear);
    window.addEventListener("scroll", clear, true);
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("mouseleave", clear);
    return () => {
      clear();
      window.removeEventListener("mouseover", over);
      window.removeEventListener("mousedown", clear);
      window.removeEventListener("scroll", clear, true);
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("mouseleave", clear);
    };
  }, []);

  if (!tip) return null;
  return (
    <div
      className={"app-tooltip" + (tip.below ? "" : " app-tooltip--above")}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  );
}
