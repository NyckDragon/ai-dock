import type { HistoryPoint } from "../lib/history";

const WIDTH = 64;
const HEIGHT = 20;
const MAX_POINTS = 28;

/**
 * Longer ranges hold hundreds of samples, far more than 64px can show. They are
 * grouped into time buckets and each keeps its point closest to the limit
 * (lowest remaining, or highest used), so the line keeps the peaks.
 */
export function bucketPoints(points: HistoryPoint[], max = MAX_POINTS, highIsWorse = false): HistoryPoint[] {
  if (points.length <= max) return points;
  const first = points[0][0];
  const span = Math.max(1, points[points.length - 1][0] - first);
  const buckets: (HistoryPoint | null)[] = new Array(max).fill(null);
  for (const [time, value] of points) {
    const index = Math.min(max - 1, Math.floor(((time - first) / span) * max));
    const current = buckets[index];
    if (!current || (highIsWorse ? value > current[1] : value < current[1])) buckets[index] = [first + ((index + 0.5) / max) * span, value];
  }
  return buckets.filter((point): point is HistoryPoint => point != null);
}

/** Quota over the chosen range, on the card's scale. Needs at least two readings. */
export function Sparkline({
  points,
  label,
  highIsWorse = false
}: {
  points: HistoryPoint[] | undefined;
  label: string;
  /** True when the values are "used" percentages. */
  highIsWorse?: boolean;
}) {
  if (!points || points.length < 2) return null;
  const shown = bucketPoints(points, MAX_POINTS, highIsWorse);
  const first = shown[0][0];
  const span = Math.max(1, shown[shown.length - 1][0] - first);
  const path = shown
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
