/* ============================================================
   Week-view calendar geometry — pure functions, unit-tested.

   The week grid drag/resize gestures (pointer-events based) are hard to verify
   with synthetic events, so all the math that actually breaks (snapping,
   duration drift, edge clamping, column hit-testing) lives here as pure
   functions covered by tests/calendar.test.mjs. The DayCol component only wires
   pointer events to these.
   ============================================================ */

export const SNAP_MIN = 30
const DAY_MIN = 24 * 60

/** clientY (px) → minutes since midnight, clamped to [0,1440] and snapped. */
export function yToMin(clientY: number, gridTop: number, hourPx: number, snap = SNAP_MIN): number {
  const raw = (clientY - gridTop) / hourPx * 60
  const clamped = Math.max(0, Math.min(DAY_MIN, raw))
  return Math.round(clamped / snap) * snap
}

/** Move a block: keep its duration, place start at (pointerMin - grabOffsetMin),
 *  clamped so the whole block stays within the day. */
export function computeMove(pointerMin: number, grabOffsetMin: number, durationMin: number): { start: number; end: number } {
  let start = pointerMin - grabOffsetMin
  start = Math.max(0, Math.min(DAY_MIN - durationMin, start))
  return { start, end: start + durationMin }
}

/** Resize the TOP edge: new start = pointerMin, never past (end - snap). */
export function computeResizeTop(pointerMin: number, endMin: number, snap = SNAP_MIN): { start: number; end: number } {
  const start = Math.max(0, Math.min(endMin - snap, pointerMin))
  return { start, end: endMin }
}

/** Resize the BOTTOM edge: new end = pointerMin, never before (start + snap). */
export function computeResizeBottom(pointerMin: number, startMin: number, snap = SNAP_MIN): { start: number; end: number } {
  const end = Math.min(DAY_MIN, Math.max(startMin + snap, pointerMin))
  return { start: startMin, end }
}

/** Which day column does clientX fall in? Returns the date or null (outside all). */
export function dateFromX(clientX: number, colBounds: { date: string; left: number; right: number }[]): string | null {
  for (const c of colBounds) if (clientX >= c.left && clientX < c.right) return c.date
  return null
}

/** Does a task occur on `date` (all args "YYYY-MM-DD")? A task with BOTH a start and
 *  due date occurs on every day in the inclusive range (the calendar shows one instance
 *  per day); with only one of them it occurs on that single day; with neither, never.
 *  Calendar-only — other views still key off due_date so a multi-day task doesn't flood
 *  "today"/inbox/counts. */
export function taskOccursOn(startDate: string | null | undefined, dueDate: string | null | undefined, date: string): boolean {
  const s = startDate || null
  const e = dueDate || null
  if (s && e) {
    const lo = s <= e ? s : e
    const hi = s <= e ? e : s
    return date >= lo && date <= hi
  }
  if (e) return date === e
  if (s) return date === s
  return false
}

/** Does a task's date range overlap the week [weekStart, weekEnd] (all "YYYY-MM-DD")?
 *  Used by 本周冲刺 (this-week sprint), which is computed live each week — a flagged task
 *  drops out automatically once its dates no longer touch the current week. Undated → no. */
export function taskInWeek(startDate: string | null | undefined, dueDate: string | null | undefined, weekStart: string, weekEnd: string): boolean {
  const s = startDate || null
  const e = dueDate || null
  if (!s && !e) return false
  const a = (s && e) ? (s <= e ? s : e) : (e || s)!
  const b = (s && e) ? (s <= e ? e : s) : (e || s)!
  return a <= weekEnd && b >= weekStart
}

/** minutes since midnight → "HH:MM". */
export function minToTime(min: number): string {
  return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0')
}

/** "HH:MM" → minutes since midnight (0 if empty/invalid). */
export function timeToMin(t: string | null | undefined): number {
  if (!t) return 0
  const [h, m] = t.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/* ============================================================
   Move/resize patch builders — the single source of truth for what dragging a task in
   the calendar changes. Pure so the single-vs-multi-day branching is unit-tested (drag
   gestures themselves can't be reliably synthesized). A multi-day task (start_date ≠
   due_date) shows one instance per day; moving one must NOT collapse the range to a
   single day, so these preserve/shift the range instead of overwriting due_date.
   ============================================================ */

// Local-midnight date math (avoids the UTC off-by-one of new Date("YYYY-MM-DD")).
// Inline so this module stays dependency-free and test-resolvable.
const parseLocal = (s: string) => new Date(s + 'T00:00:00')
const fmtLocal = (d: Date) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
const addDays = (s: string, n: number) => { const d = parseLocal(s); d.setDate(d.getDate() + n); return fmtLocal(d) }
const diffDays = (a: string, b: string) => Math.round((parseLocal(b).getTime() - parseLocal(a).getTime()) / 86400000)

export interface MovePatch { start_date?: string | null; due_date?: string | null; due_time?: string; end_time?: string }
interface TaskDates { start_date: string | null; due_date: string | null }
const isRange = (t: TaskDates) => !!(t.start_date && t.due_date && t.start_date !== t.due_date)

/** Week-view block move/resize. Multi-day → shift the whole range by (target − source)
 *  days, keeping the span (a vertical-only move is delta 0, so dates are untouched and
 *  only the time changes). Single-day → retarget to the dropped day. */
export function computeBlockMovePatch(task: TaskDates, sourceDate: string, targetDate: string, startMin: number, endMin: number): MovePatch {
  const due_time = minToTime(startMin)
  const end_time = minToTime(endMin)
  if (isRange(task)) {
    const delta = diffDays(sourceDate, targetDate)
    return { start_date: addDays(task.start_date!, delta), due_date: addDays(task.due_date!, delta), due_time, end_time }
  }
  return { start_date: null, due_date: targetDate, due_time, end_time }
}

/** Month/upcoming day drop. Multi-day → move the range to start on the dropped day,
 *  keeping its length. Otherwise → a clean single-day due_date (clears any stray
 *  start_date so a start-only task doesn't silently become a range). */
export function computeDayDropPatch(task: TaskDates, date: string): MovePatch {
  if (isRange(task)) {
    const dur = diffDays(task.start_date!, task.due_date!)
    return { start_date: date, due_date: addDays(date, dur) }
  }
  return { start_date: null, due_date: date }
}

/** Drop onto a week time-slot (gives an all-day task a time). Multi-day → keep the date
 *  range, only set the daily time window. Single-day → set day + time. */
export function computeSlotDropPatch(task: TaskDates, date: string, minutes: number): MovePatch {
  const due_time = minToTime(minutes)
  const end_time = minToTime(Math.min(24 * 60, minutes + 60))
  if (isRange(task)) return { due_time, end_time }
  return { start_date: null, due_date: date, due_time, end_time }
}
