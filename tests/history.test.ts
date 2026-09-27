import assert from "node:assert/strict";
import { test } from "node:test";
import { compactPoints, pointsInRange, type HistoryPoint } from "../src/lib/history.ts";

const HOUR = 60 * 60 * 1000;
const now = Date.UTC(2026, 8, 27, 12);

test("compactPoints keeps recent samples and one per hour before that", () => {
  const points: HistoryPoint[] = [
    [now - 40 * 24 * HOUR, 90],
    [now - 48 * HOUR, 80],
    [now - 48 * HOUR + 10 * 60 * 1000, 79],
    [now - 47 * HOUR, 70],
    [now - 2 * HOUR, 50],
    [now - HOUR, 45]
  ];
  assert.deepEqual(compactPoints(points, now), [
    [now - 48 * HOUR + 10 * 60 * 1000, 79],
    [now - 47 * HOUR, 70],
    [now - 2 * HOUR, 50],
    [now - HOUR, 45]
  ]);
});

test("pointsInRange filters by the chosen period", () => {
  const points: HistoryPoint[] = [
    [now - 10 * 24 * HOUR, 90],
    [now - 3 * 24 * HOUR, 70],
    [now - HOUR, 40]
  ];
  assert.equal(pointsInRange(points, "24h", now)?.length, 1);
  assert.equal(pointsInRange(points, "7d", now)?.length, 2);
  assert.equal(pointsInRange(points, "30d", now)?.length, 3);
  assert.equal(pointsInRange(undefined, "7d", now), undefined);
});
