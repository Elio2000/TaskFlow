import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api'
import type { Task, Project, Section } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskCheckbox } from '../components/TaskCheckbox'
import { TaskChips } from '../components/TaskChips'
import { parseTaskLabels } from '../utils/labels'
import { dragSource, draggedTaskId, noDrag } from '../utils/drag'
import { TaskModal } from '../components/TaskModal'
import { QuickComposer } from '../components/QuickComposer'
import { AIPanel } from '../ai/AIPanel'
import { BulkActionBar } from '../components/BulkActionBar'
import { DisplayMenu, type DisplayFilters } from '../components/DisplayMenu'

function applyFilters(tasks: Task[], filters: DisplayFilters): Task[] {
  return tasks.filter(t => {
    if (!filters.completed && t.completed) return false
    if (filters.priority && t.priority !== filters.priority) return false
    if (filters.labels.length > 0) {
      try {
        const ids: string[] = JSON.parse(t.labels || '[]')
        if (!filters.labels.some(l => ids.includes(l))) return false
      } catch { return false }
    }
    return true
  })
}

export { CalendarView } from './CalendarView'

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

function TaskGroup({ title, tasks, showProject, onOpenTask, onAIClick, onDelete, onToggle, defaultOpen = true, accent }: {
  title: string; tasks: Task[]; showProject?: boolean;
  onOpenTask: (t: Task) => void; onAIClick: (t: Task) => void; onDelete: () => void; onToggle: () => void;
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
      {open && tasks.map((t) => <TaskRow key={t.id} task={t} showProject={showProject} onClick={() => onOpenTask(t)} onAIClick={() => onAIClick(t)} onDelete={onDelete} onToggle={onToggle} />)}
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [filters, setFilters] = useState<DisplayFilters>({ labels: [], priority: null, completed: false, sort: 'manual' })
  const fetch = () => api.getTasks({ project_id: 'inbox', completed: '0' }).then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // List reorder via unified drag util (task id travels in dataTransfer).
  // Renumber the whole list so reordering is stable even when many tasks share
  // the default sort_order (midpoint math alone would be a no-op then).
  const handleListMove = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const dragged = filteredTasks.find(t => t.id === draggedId)
    const ordered = filteredTasks.filter(t => t.id !== draggedId)
    const ti = ordered.findIndex(t => t.id === targetId)
    if (ti < 0 || !dragged) return
    ordered.splice(ti, 0, dragged)
    await Promise.all(ordered.map((t, i) => t.sort_order === i ? Promise.resolve(undefined as any) : api.updateTask(t.id, { sort_order: i } as any)))
    fetch()
  }

  // Apply filters
  const filteredTasks = tasks.filter(t => {
    if (!filters.completed && t.completed) return false
    if (filters.priority && t.priority !== filters.priority) return false
    if (filters.labels.length > 0) {
      try {
        const ids: string[] = JSON.parse(t.labels || '[]')
        if (!filters.labels.some(l => ids.includes(l))) return false
      } catch { return false }
    }
    return true
  })

  return (
    <ViewShell title="收件箱" subtitle={filteredTasks.length ? filteredTasks.length + ' 条任务' : '干净如新'}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 8, padding: 3 }}>
            <button className={viewMode === 'list' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
              onClick={() => setViewMode('list')}><Icon name="list" size={13} /> 列表</button>
            <button className={viewMode === 'board' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
              onClick={() => setViewMode('board')}><Icon name="board" size={13} /> 看板</button>
          </div>
          <DisplayMenu filters={filters} onChange={setFilters} />
        </div>
      }>
      {viewMode === 'board' ? (
        <BoardView projectId="inbox" />
      ) : (
        <>
          <QuickComposer projectId="inbox" placeholder="添加到收件箱… 试试「明天 p2 整理文件」" onDone={fetch} />
          {filteredTasks.length === 0
            ? <EmptyState icon="inbox" text="收件箱已清空" sub="处理完所有任务，真不错！" />
            : filteredTasks.map((t) => <TaskRow key={t.id} task={t} selectable selected={selectedIds.has(t.id)} onSelect={toggleSelect}
                draggable
                onMoveTo={(draggedId) => handleListMove(draggedId, t.id)}
                onClick={() => setTaskModal(t.id)} onAIClick={(task) => { setAiTask(task); setAiOpen(true) }} onDelete={fetch} onToggle={fetch} />)
          }
        </>
      )}
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
      {selectedIds.size > 0 && viewMode === 'list' && (
        <BulkActionBar ids={[...selectedIds]} onDone={() => { setSelectedIds(new Set()); fetch() }} onClear={() => setSelectedIds(new Set())} />
      )}
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
  const [filters, setFilters] = useState<DisplayFilters>({ labels: [], priority: null, completed: false, sort: 'manual' })
  const fetch = () => api.getTasks().then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  const filtered = applyFilters(tasks, filters)
  const today = DateU.today()
  const todayTasks = filtered.filter(t => t.due_date === today && !t.completed && !t.parent_id)
  const overdue = filtered.filter(t => !t.completed && !t.parent_id && t.due_date && t.due_date < today)
  const done = filtered.filter(t => t.completed && t.due_date === today)
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }
  return (
    <ViewShell title="今天" subtitle={new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}
      actions={<DisplayMenu filters={filters} onChange={setFilters} />}>
      <QuickComposer projectId="inbox" defaultDueDate={DateU.today()} placeholder="添加今天的任务…" onDone={fetch} />
      {overdue.length > 0 && <TaskGroup title="逾期" tasks={overdue} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} onToggle={fetch} accent="var(--p1)" />}
      {todayTasks.length > 0
        ? <TaskGroup title="今天" tasks={todayTasks} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} onToggle={fetch} />
        : overdue.length === 0 && <EmptyState icon="today" text="今天没有安排" sub="好好休息，或者添加些任务" />
      }
      {done.length > 0 && <TaskGroup title="已完成" tasks={done} showProject onOpenTask={openTask} onAIClick={openAI} onDelete={fetch} onToggle={fetch} defaultOpen={false} />}
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
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const fetch = () => api.getTasks().then(setTasks)
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [])
  // Cross-day drag: dropping a task onto a day sets its due_date (due_time preserved)
  const handleDayDrop = async (draggedId: string, date: string) => {
    await api.updateTask(draggedId, { due_date: date } as any)
    fetch()
  }
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
        <div key={day.date} style={{ marginBottom: 24, borderRadius: 8, background: dragOverDate === day.date ? 'var(--bg-hover)' : undefined, transition: 'background .12s' }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDate(day.date) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate(d => d === day.date ? null : d) }}
          onDrop={(e) => { e.preventDefault(); setDragOverDate(null); const id = draggedTaskId(e); if (id) handleDayDrop(id, day.date) }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, borderBottom: '1px solid var(--border-soft)', paddingBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: day.date === DateU.today() ? 'var(--accent-text)' : 'var(--text-primary)' }}>{day.label}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{day.weekday} · {day.date}</span>
          </div>
          {day.dayTasks.length === 0
            ? <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', padding: '4px 0 4px 4px' }}>暂无任务</div>
            : day.dayTasks.map((t) => <TaskRow key={t.id} task={t} draggable showProject onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} onToggle={fetch} />)
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
   BoardView — 看板视图 (P1-005: useRef instead of module vars)
   ====================================================
   Drag uses the shared util (utils/drag): the whole card is the drag source and
   the task id travels via dataTransfer, so drops also work across other views.
   ==================================================== */
function BoardCard({ task, onOpenTask, onRefresh }: {
  task: Task; onOpenTask: (t: Task) => void; onRefresh: () => void;
}) {
  return (
    <div data-task-id={task.id} className="board-card" {...dragSource(task.id)}
      onClick={() => onOpenTask(task)}
      style={{ position: 'relative', paddingLeft: 44 }}>
      <span className="board-drag-handle"
        style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'grab', fontSize: 13, lineHeight: 1, color: 'transparent', userSelect: 'none', transition: 'color .12s' }}>⠿</span>
      <div style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)' }} {...noDrag}>
        <TaskCheckbox task={task} onToggle={onRefresh} />
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: parseTaskLabels(task.labels).length || task.due_date ? 8 : 0, lineHeight: 1.45 }}>{task.title}</div>
      <TaskChips task={task} />
    </div>
  )
}

function BoardCol({ section, tasks, onOpenTask, projectId, onRefresh }: {
  section: Section | null; tasks: Task[]; onOpenTask: (t: Task) => void;
  projectId: string; onRefresh: () => void;
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
        const taskId = draggedTaskId(e); if (!taskId) return
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
            <BoardCard task={t} onOpenTask={onOpenTask} onRefresh={onRefresh} />
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

function BoardView({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [newColName, setNewColName] = useState('')
  const [taskModal, setTaskModal] = useState<string | null>(null)

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
  const doneTasks = tasks.filter(t => t.completed && !t.parent_id)
  const [showDone, setShowDone] = useState(false)

  if (!project) return <ViewShell title="加载中..."><div /></ViewShell>

  return (
    <ViewShell title={project.name} subtitle="看板视图">
      <QuickComposer projectId={projectId} onDone={fetch} />
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
        {unsectioned.length > 0 && (
          <BoardCol section={null} tasks={unsectioned} onOpenTask={(t) => setTaskModal(t.id)} projectId={projectId} onRefresh={fetch} />
        )}
        {sections.map((s) => {
          const ts = tasks.filter(t => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed)
          return <BoardCol key={s.id} section={s} tasks={ts} onOpenTask={(t) => setTaskModal(t.id)} projectId={projectId} onRefresh={fetch} />
        })}
        <div style={{ width: 260, flex: 'none' }}>
          <input value={newColName} onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={async (e) => { if (e.key === 'Enter' && newColName.trim()) { await api.addSection(projectId, newColName.trim()); setNewColName(''); fetch() } }}
            placeholder="+ 新建分区"
            style={{ width: '100%', border: '1.5px dashed var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 13.5, background: 'transparent', color: 'var(--text-secondary)', outline: 'none' }} />
        </div>
        {/* Done column */}
        {doneTasks.length > 0 && (
          <div className="board-col" style={{ opacity: 0.7 }}>
            <button onClick={() => setShowDone(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: showDone ? 8 : 0, padding: '2px 0', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}>
              <Icon name={showDone ? 'chevronDown' : 'chevronRight'} size={13} style={{ color: 'var(--text-tertiary)' }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-tertiary)', flex: 1 }}>已完成</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{doneTasks.length}</span>
            </button>
            {showDone && doneTasks.map(t => (
              <div key={t.id} className="board-card" style={{ marginBottom: 7, opacity: 0.6 }} onClick={() => setTaskModal(t.id)}>
                <div style={{ fontSize: 13.5, fontWeight: 500, textDecoration: 'line-through', lineHeight: 1.45 }}>{t.title}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
    </ViewShell>
  )
}
