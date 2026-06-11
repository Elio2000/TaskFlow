import { api } from '../api'
import type { Task } from '../api'
import { Icon, PRIORITY_META } from '../icons'

interface TaskCheckboxProps {
  task: Task
  size?: number
  onToggle?: () => void
}

export function TaskCheckbox({ task, size = 18, onToggle }: TaskCheckboxProps) {
  const c = task.priority < 4 ? PRIORITY_META[task.priority].color : 'var(--text-tertiary)'
  return (
    <button
      className={'checkbox-circle' + (task.completed ? ' is-checked' : '')}
      style={{
        borderColor: c,
        background: task.completed
          ? c
          : task.priority < 4
            ? PRIORITY_META[task.priority].color.replace(')', ' / 0.1)').replace('var(--p', 'var(--p')
            : 'transparent',
        width: size,
        height: size,
      }}
      onClick={async (e) => {
        e.stopPropagation()
        await api.toggleTask(task.id)
        onToggle?.()
      }}
      aria-label={task.completed ? '标记未完成' : '完成任务'}
    >
      <Icon
        name="check"
        size={size - 6}
        strokeWidth={2.4}
        style={{ color: task.completed ? '#fff' : c }}
      />
    </button>
  )
}
