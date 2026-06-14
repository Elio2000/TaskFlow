import type { DragEvent } from 'react'

/* ============================================================
   Unified task drag-and-drop helpers.

   Design: the WHOLE card/row is draggable. The browser natively
   distinguishes a plain click (fires onClick → opens the task) from
   a completed drag (fires dragstart/dragend, suppresses click), so we
   do NOT need a drag handle gate. The task id travels via dataTransfer,
   which makes drops work across any view (list / board / upcoming / calendar).
   ============================================================ */

const MIME = 'application/x-taskflow-task'

/** Spread onto a task card/row to make the whole element draggable. */
export function dragSource(taskId: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(MIME, taskId)
      e.dataTransfer.setData('text/plain', taskId) // fallback for engines that drop custom MIME
      e.dataTransfer.effectAllowed = 'move'
      const el = e.currentTarget as HTMLElement
      // defer so the drag image is captured before we dim the source
      setTimeout(() => { el.style.opacity = '0.4' }, 0)
    },
    onDragEnd: (e: DragEvent) => { (e.currentTarget as HTMLElement).style.opacity = '1' },
  }
}

/** Read the dragged task id inside a drop handler. */
export function draggedTaskId(e: DragEvent): string | null {
  return e.dataTransfer.getData(MIME) || e.dataTransfer.getData('text/plain') || null
}

/**
 * Spread onto an interactive control INSIDE a draggable card (checkbox,
 * action buttons) so grabbing the control never starts a card drag.
 * The control is marked draggable and immediately cancels its own dragstart,
 * which also stops it bubbling to the draggable ancestor — more reliable than
 * stopPropagation alone, which does not prevent native drag initiation.
 */
export const noDrag = {
  draggable: true,
  onDragStart: (e: DragEvent) => { e.preventDefault(); e.stopPropagation() },
} as const
