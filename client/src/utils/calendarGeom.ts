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
