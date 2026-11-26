import test from "node:test";
import assert from "node:assert/strict";

import { activeAlertLevels, alertTone, clampCustomAlert, crossedAlert, soundName } from "../src/lib/alerts.ts";

test("levels in use are sorted, unique and include the custom one", () => {
  assert.deepEqual(activeAlertLevels([95, 75], null), [75, 95]);
  assert.deepEqual(activeAlertLevels([75, 90, 95], 90), [75, 90, 95]);
  assert.deepEqual(activeAlertLevels([90], 60), [60, 90]);
  assert.deepEqual(activeAlertLevels([], null), []);
});

test("a level counts once, when usage passes it", () => {
  // remaining 30% → 20% means used 70% → 80%: passes 75.
  assert.equal(crossedAlert(30, 20, [75, 90, 95]), 75);
  assert.equal(crossedAlert(20, 15, [75, 90, 95]), null);
  // Landing exactly on the level counts.
  assert.equal(crossedAlert(11, 10, [75, 90, 95]), 90);
  // A jump over two levels sends only the highest.
  assert.equal(crossedAlert(30, 4, [75, 90, 95]), 95);
  // Going back down (reset) is not an alert.
  assert.equal(crossedAlert(5, 100, [75, 90, 95]), null);
  // Switched-off levels are skipped.
  assert.equal(crossedAlert(30, 20, [90, 95]), null);
});

test("dot colors follow the level", () => {
  assert.equal(alertTone(60), "yellow");
  assert.equal(alertTone(75), "yellow");
  assert.equal(alertTone(90), "orange");
  assert.equal(alertTone(95), "red");
});

test("silent sends no sound name; the custom level stays in range", () => {
  assert.equal(soundName("silent"), undefined);
  assert.equal(soundName("Reminder"), "Reminder");
  assert.equal(clampCustomAlert(null), null);
  assert.equal(clampCustomAlert(10), 50);
  assert.equal(clampCustomAlert(120), 99);
  assert.equal(clampCustomAlert("70.4"), 70);
  assert.equal(clampCustomAlert("abc"), null);
});
