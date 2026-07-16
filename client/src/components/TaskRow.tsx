import { api } from '../api'
import type { Task } from '../api'
import React from 'react'
import { Icon } from '../icons'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskChips } from './TaskChips'
import { dragSource, draggedTaskId, noDrag } from '../utils/drag'

interface TaskRowProps {
  task: Task
  showProject?: boolean
  onClick?: (task: Task) => void
  onDelete?: () => void
  onToggle?: () => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
  /** Make the whole row a drag source. */
  draggable?: boolean
  /** Called when another task is dropped onto this row (reorder / move). */
  onMoveTo?: (draggedId: string) => void
}

export function TaskRow({ task, showProject, onClick, onDelete, onToggle, selectable, selected, onSelect, draggable, onMoveTo }: TaskRowProps) {
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await api.deleteTask(task.id)
    onDelete?.()
  }

  return (
    <div
      className={'task-row' + (task.completed ? ' is-done' : '')}
      data-task-id={task.id}
      {...(draggable ? dragSource(task.id) : {})}
      onDragOver={onMoveTo ? (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } : undefined}
      onDrop={onMoveTo ? (e) => { e.preventDefault(); const id = draggedTaskId(e); if (id && id !== task.id) onMoveTo(id) } : undefined}
      onClick={() => onClick && onClick(task)}
    >
      {draggable && (
        <span style={{ cursor: 'grab', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1, userSelect: 'none', flex: 'none', paddingTop: 2 }}>⠿</span>
      )}
      {selectable && (
        <input type="checkbox" checked={selected || false} {...noDrag} style={{ marginTop: 3, flex: 'none', accentColor: 'var(--accent)' }}
          onChange={() => onSelect?.(task.id)} onClick={e => e.stopPropagation()} />
      )}
      <span {...noDrag} style={{ display: 'flex', flex: 'none' }}>
        <TaskCheckbox task={task} onToggle={onToggle} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title">{task.title}</div>
        <TaskChips task={task} showProject={showProject} />
      </div>
      <div className="task-actions" style={{ paddingTop: 2 }}>
        <button
          className="btn-icon"
          {...noDrag}
          style={{ width: 26, height: 26 }}
          onClick={(e) => { handleDelete(e) }}
          title="删除"
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  )
}
