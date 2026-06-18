import assert from "node:assert/strict";
import test from "node:test";
import {
  yToMin, computeMove, computeResizeTop, computeResizeBottom,
  dateFromX, minToTime, timeToMin, taskOccursOn,
  computeBlockMovePatch, computeDayDropPatch, computeSlotDropPatch, taskInWeek,
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

test("taskOccursOn: range with both dates is inclusive on both ends", () => {
  assert.equal(taskOccursOn("2026-06-12", "2026-06-18", "2026-06-12"), true);  // start day
  assert.equal(taskOccursOn("2026-06-12", "2026-06-18", "2026-06-15"), true);  // middle
  assert.equal(taskOccursOn("2026-06-12", "2026-06-18", "2026-06-18"), true);  // due day
  assert.equal(taskOccursOn("2026-06-12", "2026-06-18", "2026-06-11"), false); // day before
  assert.equal(taskOccursOn("2026-06-12", "2026-06-18", "2026-06-19"), false); // day after
});

test("taskOccursOn: same start and due = single day", () => {
  assert.equal(taskOccursOn("2026-06-15", "2026-06-15", "2026-06-15"), true);
  assert.equal(taskOccursOn("2026-06-15", "2026-06-15", "2026-06-16"), false);
});

test("taskOccursOn: reversed dates (start > due) still resolves the span", () => {
  assert.equal(taskOccursOn("2026-06-18", "2026-06-12", "2026-06-15"), true);
  assert.equal(taskOccursOn("2026-06-18", "2026-06-12", "2026-06-20"), false);
});

test("taskOccursOn: only due date = that single day", () => {
  assert.equal(taskOccursOn(null, "2026-06-18", "2026-06-18"), true);
  assert.equal(taskOccursOn("", "2026-06-18", "2026-06-17"), false);
  assert.equal(taskOccursOn(undefined, "2026-06-18", "2026-06-19"), false);
});

test("taskOccursOn: only start date = that single day", () => {
  assert.equal(taskOccursOn("2026-06-16", null, "2026-06-16"), true);
  assert.equal(taskOccursOn("2026-06-16", "", "2026-06-17"), false);
});

test("taskOccursOn: no dates never occurs", () => {
  assert.equal(taskOccursOn(null, null, "2026-06-16"), false);
  assert.equal(taskOccursOn("", "", "2026-06-16"), false);
  assert.equal(taskOccursOn(undefined, undefined, "2026-06-16"), false);
});

test("computeBlockMovePatch: single-day retargets due_date and clears start_date", () => {
  assert.deepEqual(
    computeBlockMovePatch({ start_date: null, due_date: "2026-06-16" }, "2026-06-16", "2026-06-18", 540, 600),
    { start_date: null, due_date: "2026-06-18", due_time: "09:00", end_time: "10:00" },
  );
});

test("computeBlockMovePatch: multi-day vertical move (same day) keeps range, only time changes", () => {
  assert.deepEqual(
    computeBlockMovePatch({ start_date: "2026-06-16", due_date: "2026-06-19" }, "2026-06-18", "2026-06-18", 810, 1050),
    { start_date: "2026-06-16", due_date: "2026-06-19", due_time: "13:30", end_time: "17:30" },
  );
});

test("computeBlockMovePatch: multi-day cross-day move shifts the whole range by the delta", () => {
  assert.deepEqual(
    computeBlockMovePatch({ start_date: "2026-06-16", due_date: "2026-06-19" }, "2026-06-18", "2026-06-20", 540, 600),
    { start_date: "2026-06-18", due_date: "2026-06-21", due_time: "09:00", end_time: "10:00" },
  );
});

test("computeBlockMovePatch: shift crosses a month boundary correctly", () => {
  assert.deepEqual(
    computeBlockMovePatch({ start_date: "2026-06-29", due_date: "2026-06-30" }, "2026-06-29", "2026-07-01", 540, 600),
    { start_date: "2026-07-01", due_date: "2026-07-02", due_time: "09:00", end_time: "10:00" },
  );
});

test("computeDayDropPatch: multi-day moves range to start at drop; single-day & start-only normalize", () => {
  assert.deepEqual(computeDayDropPatch({ start_date: "2026-06-16", due_date: "2026-06-19" }, "2026-06-20"), { start_date: "2026-06-20", due_date: "2026-06-23" });
  assert.deepEqual(computeDayDropPatch({ start_date: null, due_date: "2026-06-16" }, "2026-06-20"), { start_date: null, due_date: "2026-06-20" });
  assert.deepEqual(computeDayDropPatch({ start_date: "2026-06-16", due_date: null }, "2026-06-20"), { start_date: null, due_date: "2026-06-20" });
});

test("computeSlotDropPatch: multi-day keeps range (time only); single-day sets day + time", () => {
  assert.deepEqual(computeSlotDropPatch({ start_date: "2026-06-16", due_date: "2026-06-19" }, "2026-06-20", 540), { due_time: "09:00", end_time: "10:00" });
  assert.deepEqual(computeSlotDropPatch({ start_date: null, due_date: null }, "2026-06-20", 540), { start_date: null, due_date: "2026-06-20", due_time: "09:00", end_time: "10:00" });
});

// 本周冲刺 week membership — week of 2026-06-15(Mon)…2026-06-21(Sun)
test("taskInWeek: single due date inside / on boundary / outside", () => {
  assert.equal(taskInWeek(null, "2026-06-17", "2026-06-15", "2026-06-21"), true);   // mid-week
  assert.equal(taskInWeek(null, "2026-06-15", "2026-06-15", "2026-06-21"), true);   // Monday boundary
  assert.equal(taskInWeek(null, "2026-06-21", "2026-06-15", "2026-06-21"), true);   // Sunday boundary
  assert.equal(taskInWeek(null, "2026-06-14", "2026-06-15", "2026-06-21"), false);  // day before
  assert.equal(taskInWeek(null, "2026-06-22", "2026-06-15", "2026-06-21"), false);  // day after
});

test("taskInWeek: multi-day range that spans into / brackets / misses the week", () => {
  assert.equal(taskInWeek("2026-06-10", "2026-06-16", "2026-06-15", "2026-06-21"), true);  // starts before, ends in
  assert.equal(taskInWeek("2026-06-20", "2026-06-25", "2026-06-15", "2026-06-21"), true);  // starts in, ends after
  assert.equal(taskInWeek("2026-06-01", "2026-06-30", "2026-06-15", "2026-06-21"), true);  // brackets the week
  assert.equal(taskInWeek("2026-06-01", "2026-06-07", "2026-06-15", "2026-06-21"), false); // entirely before
  assert.equal(taskInWeek("2026-06-22", "2026-06-28", "2026-06-15", "2026-06-21"), false); // entirely after
});

test("taskInWeek: only start date, and undated", () => {
  assert.equal(taskInWeek("2026-06-18", null, "2026-06-15", "2026-06-21"), true);
  assert.equal(taskInWeek(null, null, "2026-06-15", "2026-06-21"), false);
});
