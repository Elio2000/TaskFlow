import { api } from '../api'
import type { Task } from '../api'
import React from 'react'
import { Icon } from '../icons'
import { TaskCheckbox } from './TaskCheckbox'
import { TaskChips } from './TaskChips'

interface TaskRowProps {
  task: Task
  showProject?: boolean
  onClick?: (task: Task) => void
  onAIClick?: (task: Task) => void
  onDelete?: () => void
  onToggle?: () => void
  selectable?: boolean
  selected?: boolean
  onSelect?: (id: string) => void
  draggable?: boolean
  onDragStart?: (e: React.DragEvent) => void
  onDragOver?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
}

export function TaskRow({ task, showProject, onClick, onAIClick, onDelete, onToggle, selectable, selected, onSelect, draggable, onDragStart, onDragOver, onDrop }: TaskRowProps) {
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await api.deleteTask(task.id)
    onDelete?.()
  }

  return (
    <div
      className={'task-row' + (task.completed ? ' is-done' : '')}
      data-task-id={task.id}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragOver={draggable ? onDragOver : undefined}
      onDrop={draggable ? onDrop : undefined}
      onClick={() => onClick && onClick(task)}
    >
      {draggable && (
        <span style={{ cursor: 'grab', color: 'var(--text-tertiary)', fontSize: 13, lineHeight: 1, userSelect: 'none', flex: 'none', paddingTop: 2 }}
          onMouseDown={e => e.stopPropagation()}>⠿</span>
      )}
      {selectable && (
        <input type="checkbox" checked={selected || false} style={{ marginTop: 3, flex: 'none', accentColor: 'var(--accent)' }}
          onChange={() => onSelect?.(task.id)} onClick={e => e.stopPropagation()} />
      )}
      <TaskCheckbox task={task} onToggle={onToggle} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title">{task.title}</div>
        <TaskChips task={task} showProject={showProject} />
      </div>
      <div className="task-actions" style={{ paddingTop: 2 }}>
        <button
          className="btn-icon"
          style={{ width: 26, height: 26 }}
          onClick={(e) => {
            e.stopPropagation()
            onAIClick && onAIClick(task)
          }}
          title="AI 处理"
        >
          <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} />
        </button>
        <button
          className="btn-icon"
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
