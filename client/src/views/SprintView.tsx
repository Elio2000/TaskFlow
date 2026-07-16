import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Task, Project } from '../api'
import { DateU } from '../utils/date'
import { taskInWeek } from '../utils/calendarGeom'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskModal } from '../components/TaskModal'

const md = (s: string) => `${+s.slice(5, 7)}月${+s.slice(8, 10)}日`

/* 本周冲刺 — the current week (Mon–Sun, computed live, never stored) showing the tasks
   the user flagged into it (in_sprint). A flagged task drops out automatically once its
   dates leave the week. Add/remove just toggles the per-task in_sprint flag. */
export function SprintView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [searchQ, setSearchQ] = useState('')

  const fetch = () => { api.getTasks().then(setTasks); api.getProjects().then(setProjects) }
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])

  const week = DateU.weekDates(DateU.today())
  const weekStart = week[0], weekEnd = week[6]
  const inWeek = (t: Task) => taskInWeek(t.start_date, t.due_date, weekStart, weekEnd)
  const projName = (id: string) => projects.find(p => p.id === id)?.name || ''

  // Sprint = flagged tasks whose dates fall in the current week.
  const sprint = tasks.filter(t => t.in_sprint && !t.parent_id && inWeek(t))
    .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
  const done = sprint.filter(t => t.completed).length
  const progress = sprint.length ? Math.round(done / sprint.length * 100) : 0

  // Picker = this-week tasks not yet in the sprint (the "重要大事件" to promote).
  const candidates = tasks.filter(t => !t.in_sprint && !t.completed && !t.parent_id && inWeek(t)
    && (t.title.toLowerCase().includes(searchQ.toLowerCase()) || projName(t.project_id).toLowerCase().includes(searchQ.toLowerCase())))

  const setSprint = async (id: string, on: boolean) => { await api.updateTask(id, { in_sprint: on ? 1 : 0 } as any); fetch() }

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon name="flag" size={22} style={{ color: 'var(--green)' }} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>本周冲刺</h1>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>{md(weekStart)} – {md(weekEnd)} · 周一至周日</div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => { setSearchQ(''); setShowPicker(true) }}><Icon name="plus" size={14} /> 添加任务</button>
        </div>
        {showPicker && (
          <div className="modal-scrim" onClick={e => { if (e.target === e.currentTarget) setShowPicker(false) }}>
            <div className="modal-card" style={{ maxWidth: 480, marginTop: '10vh', maxHeight: '64vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name="search" size={15} style={{ color: 'var(--text-tertiary)' }} />
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="本周任务 / 按项目搜索…"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'none', color: 'var(--text-primary)' }} />
                <button className="btn-icon" onClick={() => setShowPicker(false)}><Icon name="x" size={16} /></button>
              </div>
              <div style={{ padding: 8 }}>
                {candidates.length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--text-tertiary)' }}>本周没有更多可加入的任务</div>
                  : candidates.slice(0, 40).map(t => (
                    <button key={t.id} className="menu-item" style={{ width: '100%' }} onClick={() => setSprint(t.id, true)}>
                      <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</span>
                      {t.due_date && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{md(t.due_date)}</span>}
                      {projName(t.project_id) && <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 6px' }}>{projName(t.project_id)}</span>}
                      <span style={{ fontSize: 11, color: 'var(--green)' }}>+ 加入</span>
                    </button>
                  ))}
              </div>
            </div>
          </div>
        )}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-inset)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--green)', borderRadius: 3, transition: 'width .3s' }} />
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{done}/{sprint.length} ({progress}%)</span>
        </div>
      </div>
      <div style={{ padding: '20px 32px 32px', flex: 1 }}>
        {sprint.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <Icon name="flag" size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: .5 }} />
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>本周冲刺还是空的</div>
            <div style={{ fontSize: 13 }}>点右上「添加任务」，把本周重要的大事件加进来</div>
          </div>
        ) : sprint.map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TaskRow task={t} showProject onClick={() => setTaskModal(t.id)} onDelete={fetch} onToggle={fetch} />
            </div>
            <button className="btn-icon" title="移出本周冲刺" style={{ width: 28, height: 28, flex: 'none', color: 'var(--text-tertiary)' }} onClick={() => setSprint(t.id, false)}>
              <Icon name="x" size={15} />
            </button>
          </div>
        ))}
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
    </div>
  )
}
