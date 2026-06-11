import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import type { Task, Project, Section } from '../api'
import { DateU } from '../utils/date'
import { Icon, PRIORITY_META } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskChips } from '../components/TaskChips'
import { TaskModal } from '../components/TaskModal'
import { QuickComposer } from '../components/QuickComposer'
import { AIPanel } from '../ai/AIPanel'

/* ====================================================
   ViewShell / EmptyState / TaskGroup
   ==================================================== */
function ViewShell({ title, subtitle, actions, children }: { title: string; subtitle?: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{title}</h1>
            {subtitle && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>{subtitle}</div>}
          </div>
          {actions}
        </div>
      </div>
      <div style={{ padding: '20px 32px 32px' }}>
        {children}
      </div>
    </div>
  )
}

function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)' }}>
      <Icon name={icon} size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: .5 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{text}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  )
}

function TaskGroup({ title, tasks, showProject, onOpenTask, onAIClick, onDelete, defaultOpen = true, accent }: {
  title: string; tasks: Task[]; showProject?: boolean;
  onOpenTask: (t: Task) => void; onAIClick: (t: Task) => void; onDelete: () => void;
  defaultOpen?: boolean; accent?: string;
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: open ? 4 : 0, width: '100%' }}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} style={{ color: 'var(--text-tertiary)', transition: 'transform .15s' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: accent || 'var(--text-secondary)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
      </button>
      {open && tasks.map((t) => <TaskRow key={t.id} task={t} showProject={showProject} onClick={() => onOpenTask(t)} onAIClick={() => onAIClick(t)} onDelete={onDelete} />)}
    </div>
  )
}

/* ====================================================
   InboxView
   ==================================================== */
export function InboxView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const fetch = () => api.getTasks({ project_id: 'inbox' }).then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  return (
    <ViewShell title="收件箱" subtitle={tasks.length ? tasks.length + ' 条任务' : '干净如新'}>
      <QuickComposer projectId="inbox" placeholder="添加到收件箱… 试试「明天 p2 整理文件」" onDone={fetch} />
      {tasks.length === 0
        ? <EmptyState icon="inbox" text="收件箱已清空" sub="处理完所有任务，真不错！" />
        : tasks.map((t) => <TaskRow key={t.id} task={t} onClick={() => setTaskModal(t.id)} onAIClick={(task) => { setAiTask(task); setAiOpen(true) }} onDelete={fetch} />)
      }
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ====================================================
   TodayView
   ==================================================== */
export function TodayView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const fetch = () => api.getTasks().then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  const today = DateU.today()
  const todayTasks = tasks.filter(t => t.due_date === today && !t.completed && !t.parent_id)
  const overdue = tasks.filter(t => !t.completed && !t.parent_id && t.due_date && t.due_date < today)
  const done = tasks.filter(t => t.completed && t.due_date === today)
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }
  return (
    <ViewShell title="今天" subtitle={new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}>
      <QuickComposer projectId="inbox" placeholder="添加今天的任务…" onDone={fetch} />
      {overdue.length > 0 && <TaskGroup title="逾期" tasks={overdue} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} accent="var(--p1)" />}
      {todayTasks.length > 0
        ? <TaskGroup title="今天" tasks={todayTasks} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} />
        : overdue.length === 0 && <EmptyState icon="today" text="今天没有安排" sub="好好休息，或者添加些任务" />
      }
      {done.length > 0 && <TaskGroup title="已完成" tasks={done} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} defaultOpen={false} />}
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ====================================================
   UpcomingView
   ==================================================== */
export function UpcomingView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [baseDate, setBaseDate] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const fetch = () => api.getTasks().then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(baseDate); d.setDate(d.getDate() + i)
    const ds = DateU.fmt(d)
    return { date: ds, label: DateU.human(ds), weekday: '周' + DateU.weekdayCN(ds), dayTasks: tasks.filter(t => t.due_date === ds && !t.completed && !t.parent_id) }
  })
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }
  return (
    <ViewShell title="即将到来"
      actions={<span style={{ display: 'flex', gap: 6 }}>
        <button className="btn-ghost" onClick={() => { const d = new Date(baseDate); d.setDate(d.getDate() - 7); setBaseDate(d) }}><Icon name="chevronLeft" size={15} /></button>
        <button className="btn-ghost" onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setBaseDate(d) }}>今天</button>
        <button className="btn-ghost" onClick={() => { const d = new Date(baseDate); d.setDate(d.getDate() + 7); setBaseDate(d) }}><Icon name="chevronRight" size={15} /></button>
      </span>}>
      {days.map((day) => (
        <div key={day.date} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, borderBottom: '1px solid var(--border-soft)', paddingBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: day.date === DateU.today() ? 'var(--accent-text)' : 'var(--text-primary)' }}>{day.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{day.weekday} · {day.date}</span>
          </div>
          {day.dayTasks.length === 0
            ? <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', padding: '4px 0 4px 4px' }}>暂无任务</div>
            : day.dayTasks.map((t) => <TaskRow key={t.id} task={t} showProject onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} />)
          }
          <QuickComposer projectId="inbox" defaultDueDate={day.date} placeholder="+ 为这天添加任务" autoFocus={false} onDone={fetch} />
        </div>
      ))}
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ====================================================
   CalendarView
   ==================================================== */
export function CalendarView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() } })
  const [selected, setSelected] = useState(DateU.today())
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const fetch = () => api.getTasks().then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  const today = DateU.today()
  const grid = DateU.monthGrid(cur.y, cur.m)
  const tasksByDate: Record<string, Task[]> = {}
  tasks.filter(t => !t.completed && !t.parent_id && t.due_date).forEach((t) => {
    if (!tasksByDate[t.due_date!]) tasksByDate[t.due_date!] = []
    tasksByDate[t.due_date!].push(t)
  })
  const dayTasks = tasks.filter(t => t.due_date === selected && !t.parent_id && !t.completed)
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }
  return (
    <ViewShell title={new Date(cur.y, cur.m).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })}
      actions={<span style={{ display: 'flex', gap: 6 }}>
        <button className="btn-ghost" onClick={() => setCur((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}><Icon name="chevronLeft" size={15} /></button>
        <button className="btn-ghost" onClick={() => { const d = new Date(); setCur({ y: d.getFullYear(), m: d.getMonth() }); setSelected(today) }}>今天</button>
        <button className="btn-ghost" onClick={() => setCur((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}><Icon name="chevronRight" size={15} /></button>
      </span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 4 }}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => <div key={w} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0', fontWeight: 500 }}>{w}</div>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map((c) => {
              const ts = tasksByDate[c.date] || []
              const isSel = c.date === selected, isToday = c.date === today
              return (
                <div key={c.date} onClick={() => setSelected(c.date)} style={{ minHeight: 70, borderRadius: 8, padding: '5px 6px', cursor: 'pointer', background: isSel ? 'var(--accent-soft)' : isToday ? 'var(--bg-hover)' : c.inMonth ? 'var(--bg-card)' : 'transparent', border: isSel ? '1.5px solid var(--accent)' : '1px solid var(--border-soft)', opacity: c.inMonth ? 1 : 0.4 }}>
                  <div style={{ fontSize: 12.5, fontWeight: isToday || isSel ? 700 : 400, color: isToday ? 'var(--accent-text)' : isSel ? 'var(--accent-text)' : 'var(--text-primary)', marginBottom: 3, textAlign: 'right' }}>{c.day}</div>
                  {ts.slice(0, 3).map((t) => (
                    <div key={t.id} onClick={(e) => { e.stopPropagation(); setTaskModal(t.id) }} style={{ fontSize: 11, lineHeight: 1.3, padding: '2px 4px', borderRadius: 4, marginBottom: 2, background: 'var(--bg-inset)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_META[t.priority].color, display: 'inline-block', marginRight: 3 }}></span>{t.title}
                    </div>
                  ))}
                  {ts.length > 3 && <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', paddingLeft: 4 }}>+{ts.length - 3} 条</div>}
                </div>
              )
            })}
          </div>
        </div>
        <div style={{ borderLeft: '1px solid var(--border-soft)', paddingLeft: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 10, color: selected === today ? 'var(--accent-text)' : 'var(--text-primary)' }}>
            {DateU.human(selected)} <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text-tertiary)' }}>({dayTasks.length} 条)</span>
          </div>
          <QuickComposer projectId="inbox" defaultDueDate={selected} placeholder="为这天添加任务…" autoFocus={false} onDone={fetch} />
          {dayTasks.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingTop: 8 }}>无任务</div>
            : dayTasks.map((t) => <TaskRow key={t.id} task={t} showProject onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} />)
          }
        </div>
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ====================================================
   BoardView — 看板视图 (P1-005: useRef instead of module vars)
   ====================================================
   Drag state is passed via a shared ref from BoardView through BoardCol to BoardCard.
   Using React refs instead of module-level variables eliminates race conditions.
   ==================================================== */
type DragState = { taskId: string | null; fromSection: string | null }

function BoardCard({ task, sectionId, onOpenTask, dragRef, handleDownRef }: {
  task: Task; sectionId: string | null; onOpenTask: (t: Task) => void;
  dragRef: React.MutableRefObject<DragState>; handleDownRef: React.MutableRefObject<boolean>;
}) {
  return (
    <div data-task-id={task.id} className="board-card" draggable
      onDragStart={(e) => {
        if (!handleDownRef.current) { e.preventDefault(); return }
        dragRef.current.taskId = task.id; dragRef.current.fromSection = sectionId
        e.dataTransfer.effectAllowed = 'move'
        setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.4' }, 0)
      }}
      onDragEnd={(e) => { handleDownRef.current = false; dragRef.current.taskId = null; (e.target as HTMLElement).style.opacity = '1' }}
      onClick={() => onOpenTask(task)}
      style={{ position: 'relative', paddingLeft: 22 }}>
      <span className="board-drag-handle"
        onMouseDown={(e) => { e.stopPropagation(); handleDownRef.current = true }}
        onMouseUp={() => { handleDownRef.current = false }}
        style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'grab', fontSize: 13, lineHeight: 1, color: 'transparent', userSelect: 'none', transition: 'color .12s' }}>⠿</span>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: (task.labels ? JSON.parse(task.labels).length : 0) || task.due_date ? 8 : 0, lineHeight: 1.45 }}>{task.title}</div>
      <TaskChips task={task} />
    </div>
  )
}

function BoardCol({ section, tasks, onOpenTask, projectId, onRefresh, dragRef, handleDownRef }: {
  section: Section | null; tasks: Task[]; onOpenTask: (t: Task) => void;
  projectId: string; onRefresh: () => void;
  dragRef: React.MutableRefObject<DragState>; handleDownRef: React.MutableRefObject<boolean>;
}) {
  const [addingCard, setAddingCard] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [insertBefore, setInsertBefore] = useState<string | null>(null)
  const colRef = useRef<HTMLDivElement>(null)

  const getInsertTarget = useCallback((clientY: number) => {
    if (!colRef.current) return 'end'
    const cards = [...colRef.current.querySelectorAll('[data-task-id]')]
    for (const card of cards) {
      const r = card.getBoundingClientRect()
      if (clientY < r.top + r.height / 2) return (card as HTMLElement).dataset.taskId || null
    }
    return 'end'
  }, [])

  const sectionId = section ? section.id : null

  return (
    <div className="board-col" ref={colRef}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); setInsertBefore(getInsertTarget(e.clientY)) }}
      onDragLeave={(e) => { if (!colRef.current?.contains(e.relatedTarget as Node)) { setDragOver(false); setInsertBefore(null) } }}
      onDrop={async (e) => {
        e.preventDefault(); setDragOver(false); setInsertBefore(null)
        const taskId = dragRef.current.taskId; if (!taskId) return
        const newSectionId = section ? section.id : null
        const tasksInCol = tasks.filter(t => t.id !== taskId)
        let newOrder: number
        if (insertBefore === 'end' || !insertBefore) {
          newOrder = tasksInCol.length > 0 ? Math.max(...tasksInCol.map(t => t.sort_order)) + 1 : 0
        } else {
          const idx = tasksInCol.findIndex(t => t.id === insertBefore)
          if (idx === 0) newOrder = tasksInCol[0].sort_order - 1
          else newOrder = idx > 0 ? (tasksInCol[idx - 1].sort_order + tasksInCol[idx].sort_order) / 2 : 0
        }
        await api.updateTask(taskId, { section_id: newSectionId, sort_order: newOrder } as any)
        onRefresh()
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '2px 0' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{section ? section.name : '未分区'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
        <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setAddingCard(true)}><Icon name="plus" size={14} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 40, borderRadius: 10, padding: dragOver ? '4px' : '0', background: dragOver ? 'var(--bg-hover)' : 'transparent', border: dragOver ? '1.5px dashed var(--border)' : '1.5px solid transparent', transition: 'all .12s' }}>
        {addingCard && (
          <div className="board-card" style={{ padding: 8 }}>
            <QuickComposer projectId={projectId} sectionId={sectionId || undefined} placeholder="任务名称…" autoFocus onDone={() => { setAddingCard(false); onRefresh() }} />
          </div>
        )}
        {tasks.map((t) => (
          <div key={t.id}>
            {insertBefore === t.id && dragOver && <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />}
            <BoardCard task={t} sectionId={sectionId} onOpenTask={onOpenTask} dragRef={dragRef} handleDownRef={handleDownRef} />
          </div>
        ))}
        {insertBefore === 'end' && dragOver && <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />}
        {!addingCard && (
          <button className="btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--text-tertiary)', fontSize: 13 }} onClick={() => setAddingCard(true)}>
            <Icon name="plus" size={13} /> 添加任务
          </button>
        )}
      </div>
    </div>
  )
}

export function BoardView({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [newColName, setNewColName] = useState('')
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const boardDrag = useRef<DragState>({ taskId: null, fromSection: null })
  const boardHandleDown = useRef(false)

  const fetch = async () => {
    const [p, secs, ts] = await Promise.all([
      api.getProject(projectId),
      api.getSections(projectId),
      api.getTasks({ project_id: projectId }),
    ])
    setProject(p); setSections(secs); setTasks(ts)
  }
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [projectId])

  const unsectioned = tasks.filter(t => !t.section_id && !t.parent_id && !t.completed)

  if (!project) return <ViewShell title="加载中..."><div /></ViewShell>

  return (
    <ViewShell title={project.name} subtitle="看板视图">
      <QuickComposer projectId={projectId} onDone={fetch} />
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
        {unsectioned.length > 0 && (
          <BoardCol section={null} tasks={unsectioned} onOpenTask={(t) => setTaskModal(t.id)} projectId={projectId} onRefresh={fetch} dragRef={boardDrag} handleDownRef={boardHandleDown} />
        )}
        {sections.map((s) => {
          const ts = tasks.filter(t => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed)
          return <BoardCol key={s.id} section={s} tasks={ts} onOpenTask={(t) => setTaskModal(t.id)} projectId={projectId} onRefresh={fetch} dragRef={boardDrag} handleDownRef={boardHandleDown} />
        })}
        <div style={{ width: 260, flex: 'none' }}>
          <input value={newColName} onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={async (e) => { if (e.key === 'Enter' && newColName.trim()) { await api.addSection(projectId, newColName.trim()); setNewColName(''); fetch() } }}
            placeholder="+ 新建分区"
            style={{ width: '100%', border: '1.5px dashed var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 13.5, background: 'transparent', color: 'var(--text-secondary)', outline: 'none' }} />
        </div>
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || projectId} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ====================================================
   ListView — 列表视图
   ==================================================== */
export function ListView({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [newSec, setNewSec] = useState(false)
  const [newSecName, setNewSecName] = useState('')
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)

  const fetch = async () => {
    const [p, secs, ts] = await Promise.all([
      api.getProject(projectId),
      api.getSections(projectId),
      api.getTasks({ project_id: projectId }),
    ])
    setProject(p); setSections(secs); setTasks(ts)
  }
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [projectId])

  const unsectioned = tasks.filter(t => !t.section_id && !t.parent_id && !t.completed)
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }

  if (!project) return <ViewShell title="加载中..."><div /></ViewShell>

  return (
    <ViewShell title={project.name} subtitle="列表视图">
      <QuickComposer projectId={projectId} onDone={fetch} />
      {unsectioned.map((t) => <TaskRow key={t.id} task={t} onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} />)}
      {sections.map((s) => {
        const ts = tasks.filter(t => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed)
        return (
          <div key={s.id} style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1.5px solid var(--border)', paddingBottom: 5, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', flex: 1 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ts.length}</span>
              <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={async () => { await api.deleteSection(s.id); fetch() }}><Icon name="trash" size={12} /></button>
            </div>
            {ts.map((t) => <TaskRow key={t.id} task={t} onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} />)}
            <QuickComposer projectId={projectId} sectionId={s.id} autoFocus={false} onDone={fetch} />
          </div>
        )
      })}
      <div style={{ marginTop: 16 }}>
        {newSec ? (
          <input autoFocus value={newSecName} onChange={(e) => setNewSecName(e.target.value)}
            onKeyDown={async (e) => { if (e.key === 'Enter' && newSecName.trim()) { await api.addSection(projectId, newSecName.trim()); setNewSecName(''); setNewSec(false); fetch() } if (e.key === 'Escape') { setNewSec(false); setNewSecName('') } }}
            onBlur={async () => { if (newSecName.trim()) { await api.addSection(projectId, newSecName.trim()); fetch() } setNewSec(false); setNewSecName('') }}
            placeholder="分区名称…"
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', width: '100%' }} />
        ) : (
          <button className="btn-ghost" style={{ color: 'var(--text-tertiary)' }} onClick={() => setNewSec(true)}>
            <Icon name="plus" size={14} /> 添加分区
          </button>
        )}
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || projectId} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}
