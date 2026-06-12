import { useState, useEffect, useRef, type ReactNode } from 'react'
import { api } from '../api'
import type { Task, Project, Section, Label } from '../api'
import { DateU } from '../utils/date'
import { parseTaskLabels } from '../utils/labels'
import { usePopover } from './Popover'
import { Icon, PRIORITY_META } from '../icons'
import { TaskCheckbox } from './TaskCheckbox'
import { DateMenu } from './DateMenu'
import { PriorityMenu } from './PriorityMenu'
import { LabelMenu } from './LabelMenu'
import { ProjectMenu } from './ProjectMenu'

const FIELD_LABELS: Record<string, string> = {
  title: '标题', description: '描述', priority: '优先级',
  due_date: '截止日期', due_time: '截止时间', completed: '完成状态',
  labels: '标签', project_id: '项目', section_id: '分区', repeat: '重复'
}

interface TaskModalProps {
  taskId: string
  onClose: () => void
}

export function TaskModal({ taskId, onClose }: TaskModalProps) {
  const [task, setTask] = useState<Task | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [section, setSection] = useState<Section | null>(null)
  const [subtasks, setSubtasks] = useState<Task[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [activities, setActivities] = useState<any[]>([])

  const [editTitle, setEditTitle] = useState(false)
  const [titleVal, setTitleVal] = useState('')
  const [descVal, setDescVal] = useState('')
  const [newSub, setNewSub] = useState('')
  const [reminderVal, setReminderVal] = useState('')
  const titleRef = useRef<HTMLInputElement | null>(null)

  const dp = usePopover()
  const pp = usePopover()
  const lp = usePopover()
  const projp = usePopover()

  // Fetch task data
  const loadTask = () => {
    api.getTask(taskId).then((t) => {
      setTask(t)
      setTitleVal(t.title)
      setDescVal(t.description || '')
      setReminderVal(t.reminder || '')
      api.getTaskActivities(taskId).then(setActivities).catch(() => {})
    }).catch(() => setTask(null))
  }

  useEffect(() => {
    loadTask()
  }, [taskId])

  // Load related data when task loads
  useEffect(() => {
    if (!task) return

    api.getProjects().then((projs) => {
      setProject(projs.find((p) => p.id === task.project_id) || null)
    }).catch(() => {})

    if (task.section_id) {
      api.getSections(task.project_id).then((secs) => {
        setSection(secs.find((s) => s.id === task.section_id) || null)
      }).catch(() => {})
    } else {
      setSection(null)
    }

    api.getTasks({ parent_id: task.id }).then(setSubtasks).catch(() => setSubtasks([]))
    api.getLabels().then(setLabels).catch(() => setLabels([]))
  }, [task?.id])

  if (!task) return null

  const taskLabelIds = parseTaskLabels(task.labels)
  const pc = PRIORITY_META[task.priority]

  const save = (patch: Partial<Task>) => {
    api.updateTask(taskId, patch).then(loadTask)
  }

  const addSubtask = () => {
    if (!newSub.trim()) return
    api.addTask({
      title: newSub.trim(),
      parent_id: taskId,
      project_id: task.project_id,
      priority: 4,
    }).then(() => {
      setNewSub('')
      api.getTasks({ parent_id: taskId }).then(setSubtasks)
    })
  }

  const deleteSubtask = (id: string) => {
    api.deleteTask(id).then(() => {
      api.getTasks({ parent_id: taskId }).then(setSubtasks)
    })
  }

  const deleteTask = () => {
    api.deleteTask(task.id).then(onClose)
  }

  return (
    <div
      className="modal-scrim"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="modal-card fade-up"
        style={{
          width: 'min(680px, 95vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
          marginTop: '6vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 18px 12px',
            borderBottom: '1px solid var(--border-soft)',
          }}
        >
          <TaskCheckbox task={task} size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editTitle ? (
              <input
                ref={titleRef}
                autoFocus
                value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                onBlur={() => {
                  if (titleVal.trim()) save({ title: titleVal.trim() })
                  setEditTitle(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (titleVal.trim()) save({ title: titleVal.trim() })
                    setEditTitle(false)
                  }
                  if (e.key === 'Escape') {
                    setTitleVal(task.title)
                    setEditTitle(false)
                  }
                }}
                style={{
                  width: '100%',
                  border: 'none',
                  outline: 'none',
                  background: 'none',
                  fontSize: 17,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              />
            ) : (
              <div
                onClick={() => setEditTitle(true)}
                style={{
                  fontSize: 17,
                  fontWeight: 600,
                  cursor: 'text',
                  color: task.completed
                    ? 'var(--text-tertiary)'
                    : 'var(--text-primary)',
                  textDecoration: task.completed ? 'line-through' : 'none',
                  lineHeight: 1.4,
                }}
              >
                {task.title || (
                  <span style={{ color: 'var(--text-tertiary)' }}>点击编辑标题</span>
                )}
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 220px',
            flex: 1,
            minHeight: 0,
          }}
        >
          {/* Left: Description + Subtasks */}
          <div
            style={{
              padding: '14px 18px',
              borderRight: '1px solid var(--border-soft)',
              overflowY: 'auto',
            }}
          >
            <textarea
              value={descVal}
              onChange={(e) => setDescVal(e.target.value)}
              onBlur={() => save({ description: descVal })}
              placeholder="添加描述…"
              style={{
                width: '100%',
                minHeight: 90,
                resize: 'vertical',
                border: '1px solid transparent',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 13.5,
                background: 'transparent',
                color: 'var(--text-primary)',
                outline: 'none',
                fontFamily: 'var(--font)',
                lineHeight: 1.6,
              }}
              onFocus={(e) => {
                e.target.style.borderColor = 'var(--border)'
              }}
              onBlurCapture={(e) => {
                e.target.style.borderColor = 'transparent'
              }}
            />

            {/* Subtasks */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Icon
                  name="subtask"
                  size={14}
                  style={{ color: 'var(--text-tertiary)' }}
                />
                <span
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: 'var(--text-secondary)',
                  }}
                >
                  子任务
                </span>
                {subtasks.length > 0 && (
                  <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
                    {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                  </span>
                )}
              </div>
              {subtasks.map((sub) => (
                <div
                  key={sub.id}
                  className="task-row"
                  style={{ padding: '7px 4px' }}
                >
                  <TaskCheckbox task={sub} size={16} />
                  <span
                    style={{
                      fontSize: 13.5,
                      flex: 1,
                      color: sub.completed
                        ? 'var(--text-tertiary)'
                        : 'var(--text-primary)',
                      textDecoration: sub.completed ? 'line-through' : 'none',
                    }}
                  >
                    {sub.title}
                  </span>
                  <button
                    className="btn-icon"
                    style={{ width: 24, height: 24, opacity: 0.4 }}
                    onClick={() => deleteSubtask(sub.id)}
                  >
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input
                  value={newSub}
                  onChange={(e) => setNewSub(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addSubtask()
                  }}
                  placeholder="添加子任务…"
                  style={{
                    flex: 1,
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '6px 10px',
                    fontSize: 13,
                    background: 'var(--bg-content)',
                    color: 'var(--text-primary)',
                    outline: 'none',
                  }}
                />
                <button
                  className="btn-outline"
                  style={{ padding: '6px 12px' }}
                  onClick={addSubtask}
                >
                  <Icon name="plus" size={14} />
                </button>
              </div>
            </div>
          </div>

          {/* Right: Property column */}
          <div style={{ padding: '14px 14px', overflowY: 'auto' }}>
            {/* Project / Section */}
            <PropRow label="项目" icon="hash">
              <button
                ref={projp.ref}
                className="btn-ghost"
                style={{ fontSize: 13, padding: '3px 7px' }}
                onClick={projp.toggle}
              >
                {project ? (
                  <>
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: '50%',
                        background: project.color,
                        display: 'inline-block',
                      }}
                    />{' '}
                    {project.name}
                    {section ? ' / ' + section.name : ''}
                  </>
                ) : (
                  '无'
                )}
              </button>
              {projp.open && (
                <ProjectMenu
                  anchorRef={projp.ref}
                  onClose={projp.close}
                  onPick={(pid, sid) => {
                    save({ project_id: pid, section_id: sid })
                    projp.close()
                  }}
                />
              )}
            </PropRow>

            {/* Start date */}
            <PropRow label="开始" icon="upcoming">
              <button
                className="btn-ghost"
                style={{ fontSize: 13, padding: '3px 7px' }}
                onClick={() => {
                  const v = window.prompt(
                    '开始日期 (YYYY-MM-DD)，留空清除：',
                    task.start_date || '',
                  )
                  if (v !== null) {
                    save({ start_date: v.trim() || null })
                  }
                }}
              >
                {task.start_date ? DateU.human(task.start_date) : '无（单天）'}
              </button>
            </PropRow>

            {/* Due date */}
            <PropRow label="截止日期" icon="calendar">
              <button
                ref={dp.ref}
                className="btn-ghost"
                style={{
                  fontSize: 13,
                  padding: '3px 7px',
                  color: DateU.isOverdue(task.due_date)
                    ? 'var(--p1)'
                    : task.due_date === DateU.today()
                      ? 'var(--green)'
                      : undefined,
                }}
                onClick={dp.toggle}
              >
                {task.due_date
                  ? DateU.human(task.due_date) +
                    (task.due_time ? ' ' + task.due_time : '')
                  : '无日期'}
              </button>
              {dp.open && (
                <DateMenu
                  anchorRef={dp.ref}
                  value={task.due_date}
                  time={task.due_time}
                  repeat={task.repeat}
                  onPick={(v) => {
                    save(v)
                    dp.close()
                  }}
                  onClose={dp.close}
                />
              )}
            </PropRow>

            {/* Priority */}
            <PropRow label="优先级" icon="flag">
              <button
                ref={pp.ref}
                className="btn-ghost"
                style={{
                  fontSize: 13,
                  padding: '3px 7px',
                  color: pc.color,
                }}
                onClick={pp.toggle}
              >
                <Icon name="flag" size={13} style={{ color: pc.color }} />{' '}
                {pc.name}
              </button>
              {pp.open && (
                <PriorityMenu
                  anchorRef={pp.ref}
                  onClose={pp.close}
                  onPick={(p) => {
                    save({ priority: p })
                    pp.close()
                  }}
                />
              )}
            </PropRow>

            {/* Labels */}
            <PropRow label="标签" icon="tag">
              <button
                ref={lp.ref}
                className="btn-ghost"
                style={{ fontSize: 13, padding: '3px 7px' }}
                onClick={lp.toggle}
              >
                {taskLabelIds.length > 0
                  ? taskLabelIds.map((id) => {
                      const l = labels.find((lb) => lb.id === id)
                      return l ? (
                        <span key={id} style={{ marginRight: 4 }}>
                          <span
                            style={{
                              width: 7,
                              height: 7,
                              borderRadius: '50%',
                              background: l.color,
                              display: 'inline-block',
                              marginRight: 3,
                            }}
                          />
                          {l.name}
                        </span>
                      ) : null
                    })
                  : '无标签'}
              </button>
              {lp.open && (
                <LabelMenu
                  anchorRef={lp.ref}
                  onClose={lp.close}
                  selected={taskLabelIds}
                  onToggle={(id) => {
                    const arr = taskLabelIds.includes(id)
                      ? taskLabelIds.filter((x) => x !== id)
                      : [...taskLabelIds, id]
                    save({ labels: arr as any })
                  }}
                />
              )}
            </PropRow>

            {/* Reminder */}
            <PropRow label="提醒" icon="bell">
              <select
                value={reminderVal}
                onChange={(e) => {
                  setReminderVal(e.target.value)
                  save({ reminder: e.target.value || null })
                }}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 7,
                  padding: '4px 8px',
                  fontSize: 12.5,
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  outline: 'none',
                }}
              >
                <option value="">无</option>
                <option value="due_time">准时</option>
                <option value="5min">提前5分钟</option>
                <option value="30min">提前30分钟</option>
                <option value="1h">提前1小时</option>
                <option value="1d">提前1天</option>
              </select>
            </PropRow>

            {/* Separator */}
            <div style={{ borderTop: '1px solid var(--border-soft)', margin: '12px 0' }} />

            {/* Delete */}
            <button
              className="btn-ghost"
              style={{
                color: 'var(--p1)',
                width: '100%',
                justifyContent: 'flex-start',
              }}
              onClick={deleteTask}
            >
              <Icon name="trash" size={14} /> 删除任务
            </button>
          </div>
        </div>

        {/* Activity Log */}
        {activities.length > 0 && (
          <div style={{ padding: '10px 18px', borderTop: '1px solid var(--border-soft)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 8 }}>修改记录</div>
            {activities.map((a: any) => (
              <div key={a.id} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4, display: 'flex', gap: 6 }}>
                <span style={{ color: 'var(--text-tertiary)', flex: 'none', width: 60 }}>
                  {new Date(a.created_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
                </span>
                <span>
                  将 <b>{FIELD_LABELS[a.field] || a.field}</b> 从{' '}
                  <code style={{ background: 'var(--bg-inset)', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>{a.old_value || '空'}</code>
                  {' '}改为{' '}
                  <code style={{ background: 'var(--bg-inset)', borderRadius: 3, padding: '0 4px', fontSize: 11 }}>{a.new_value || '空'}</code>
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div
          style={{
            padding: '8px 18px',
            borderTop: '1px solid var(--border-soft)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            创建于 {new Date(task.created_at).toLocaleDateString('zh-CN')}
            {task.completed_at
              ? ' · 完成于 ' +
                new Date(task.completed_at).toLocaleDateString('zh-CN')
              : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              className="btn-primary"
              style={{ fontSize: 12.5, padding: '5px 14px' }}
              onClick={onClose}
            >
              完成
            </button>
          </span>
        </div>
      </div>
    </div>
  )
}

function PropRow({
  label,
  icon,
  children,
}: {
  label: string
  icon: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        marginBottom: 10,
        minHeight: 30,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: 64,
          paddingTop: 4,
          flex: 'none',
        }}
      >
        <Icon name={icon} size={13} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          {label}
        </span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  )
}
