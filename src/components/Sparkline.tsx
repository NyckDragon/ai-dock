import type { HistoryPoint } from "../lib/history";

const WIDTH = 64;
const HEIGHT = 20;

/** Remaining quota over the last 24 hours. Needs at least two readings. */
export function Sparkline({ points, label }: { points: HistoryPoint[] | undefined; label: string }) {
  if (!points || points.length < 2) return null;
  const first = points[0][0];
  const span = Math.max(1, points[points.length - 1][0] - first);
  const path = points
    .map(([time, value], index) => {
      const x = ((time - first) / span) * (WIDTH - 2) + 1;
      const y = HEIGHT - 1 - (Math.max(0, Math.min(100, value)) / 100) * (HEIGHT - 2);
      return (index === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
    })
    .join(" ");

  return (
    <svg className="sparkline" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      <path d={path} fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
