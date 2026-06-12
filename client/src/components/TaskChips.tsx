import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Task, Label, Project, Section } from '../api'
import { DateU } from '../utils/date'
import { parseTaskLabels } from '../utils/labels'
import { Icon } from '../icons'

interface TaskChipsProps {
  task: Task
  showProject?: boolean
}

const REPEAT_LABELS: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
}

export function TaskChips({ task, showProject }: TaskChipsProps) {
  const [labels, setLabels] = useState<Label[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [section, setSection] = useState<Section | null>(null)
  const [subtasks, setSubtasks] = useState<Task[]>([])

  useEffect(() => {
    api.getLabels().then(setLabels).catch(() => {})
    api.getProjects().then((projects) => {
      setProject(projects.find((p) => p.id === task.project_id) || null)
    }).catch(() => {})
    if (task.section_id) {
      api.getSections(task.project_id).then((sections) => {
        setSection(sections.find((s) => s.id === task.section_id) || null)
      }).catch(() => {})
    } else {
      setSection(null)
    }
    api.getTasks({ parent_id: task.id }).then(setSubtasks).catch(() => {})
  }, [task.id, task.project_id, task.section_id])

  const taskLabelIds: string[] = parseTaskLabels(task.labels)

  const doneSubs = subtasks.filter((s) => s.completed).length
  const overdue = !task.completed && DateU.isOverdue(task.due_date)

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4, alignItems: 'center' }}>
      {task.due_date && (
        <span
          className="chip"
          style={{
            color: overdue ? 'var(--p1)' : task.due_date === DateU.today() ? 'var(--green)' : undefined,
            background: overdue ? 'var(--accent-soft)' : undefined,
          }}
        >
          <Icon name="calendar" size={12} />
          {DateU.human(task.due_date)}
          {task.due_time ? ' ' + task.due_time : ''}
        </span>
      )}
      {task.repeat && (
        <span className="chip">
          <Icon name="repeat" size={12} />
          {REPEAT_LABELS[task.repeat] || task.repeat}
        </span>
      )}
      {subtasks.length > 0 && (
        <span className="chip">
          <Icon name="subtask" size={12} />
          {doneSubs}/{subtasks.length}
        </span>
      )}
      {taskLabelIds.map((id) => {
        const l = labels.find((lb) => lb.id === id)
        return l ? (
          <span key={id} className="chip">
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }} />
            {l.name}
          </span>
        ) : null
      })}
      {task.reminder && (
        <span className="chip">
          <Icon name="bell" size={12} />
          {task.reminder}
        </span>
      )}
      {showProject && project && (
        <span className="chip" style={{ marginLeft: 'auto', background: 'none' }}>
          {project.name}{section ? ' / ' + section.name : ''}
          <Icon name="hash" size={11} style={{ color: project.color }} />
        </span>
      )}
    </div>
  )
}
