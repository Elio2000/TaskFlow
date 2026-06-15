import assert from "node:assert/strict";
import test from "node:test";
import {
  yToMin, computeMove, computeResizeTop, computeResizeBottom,
  dateFromX, minToTime, timeToMin,
} from "../client/src/utils/calendarGeom.ts";

// HOUR_PX = 56 in the app; gridTop = 0 for these tests.
test("yToMin: exact hour and clamps", () => {
  assert.equal(yToMin(0, 0, 56), 0);
  assert.equal(yToMin(56, 0, 56), 60);       // 1:00
  assert.equal(yToMin(784, 0, 56), 840);     // 14:00
  assert.equal(yToMin(-100, 0, 56), 0);      // clamp low
  assert.equal(yToMin(999999, 0, 56), 1440); // clamp high (24:00)
});

test("yToMin: snaps to 30-min grid", () => {
  assert.equal(yToMin(28, 0, 56), 30);  // 30 min exactly
  assert.equal(yToMin(812, 0, 56), 870); // 14:30
});

test("computeMove keeps duration", () => {
  assert.deepEqual(computeMove(600, 30, 60), { start: 570, end: 630 });
});

test("computeMove clamps within the day", () => {
  assert.deepEqual(computeMove(1400, 0, 60), { start: 1380, end: 1440 }); // end can't exceed 24:00
  assert.deepEqual(computeMove(-50, 0, 60), { start: 0, end: 60 });       // start can't go below 0
});

test("computeResizeTop never crosses the bottom", () => {
  assert.deepEqual(computeResizeTop(540, 600), { start: 540, end: 600 });
  assert.deepEqual(computeResizeTop(590, 600, 30), { start: 570, end: 600 }); // min 30-min height
  assert.deepEqual(computeResizeTop(-10, 600), { start: 0, end: 600 });
});

test("computeResizeBottom never crosses the top", () => {
  assert.deepEqual(computeResizeBottom(660, 600), { start: 600, end: 660 });
  assert.deepEqual(computeResizeBottom(610, 600, 30), { start: 600, end: 630 }); // min 30-min height
  assert.deepEqual(computeResizeBottom(99999, 600), { start: 600, end: 1440 });  // clamp to 24:00
});

test("dateFromX hit-tests column bounds", () => {
  const cols = [{ date: "a", left: 0, right: 100 }, { date: "b", left: 100, right: 200 }];
  assert.equal(dateFromX(50, cols), "a");
  assert.equal(dateFromX(150, cols), "b");
  assert.equal(dateFromX(250, cols), null);
});

test("minToTime / timeToMin round-trip", () => {
  assert.equal(minToTime(840), "14:00");
  assert.equal(minToTime(90), "01:30");
  assert.equal(timeToMin("14:00"), 840);
  assert.equal(timeToMin(""), 0);
  assert.equal(timeToMin(null), 0);
});
