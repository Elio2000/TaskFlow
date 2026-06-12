import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task, Project, Section } from '../api'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskChips } from '../components/TaskChips'
import { TaskCheckbox } from '../components/TaskCheckbox'
import { TaskModal } from '../components/TaskModal'
import { QuickComposer } from '../components/QuickComposer'
import { AIPanel } from '../ai/AIPanel'
import { parseTaskLabels } from '../utils/labels'

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

type DragState = { taskId: string | null; fromSection: string | null }

export function ProjectView({ projectId }: { projectId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list')
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const [newColName, setNewColName] = useState('')
  const [newSec, setNewSec] = useState(false)
  const [newSecName, setNewSecName] = useState('')
  const boardDrag = useRef<DragState>({ taskId: null, fromSection: null })
  const boardHandleDown = useRef(false)

  const fetch = async () => {
    const [p, secs, ts] = await Promise.all([
      api.getProject(projectId), api.getSections(projectId), api.getTasks({ project_id: projectId }),
    ])
    setProject(p); setSections(secs); setTasks(ts)
    if (p) setViewMode(p.view_mode === 'board' ? 'board' : 'list')
  }
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [projectId])

  const switchView = (m: 'list' | 'board') => {
    setViewMode(m)
    api.updateProject(projectId, { view_mode: m })
  }

  if (!project) return <ViewShell title="加载中..."><div /></ViewShell>

  const unsectioned = tasks.filter(t => !t.section_id && !t.parent_id && !t.completed)
  const openTask = (t: Task) => setTaskModal(t.id)
  const openAI = (t: Task) => { setAiTask(t); setAiOpen(true) }

  const actions = (
    <div style={{ display: 'flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 8, padding: 3 }}>
      <button className={viewMode === 'list' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
        onClick={() => switchView('list')}><Icon name="list" size={13} /> 列表</button>
      <button className={viewMode === 'board' ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px' }}
        onClick={() => switchView('board')}><Icon name="board" size={13} /> 看板</button>
    </div>
  )

  return (
    <ViewShell title={project.name} subtitle={viewMode === 'board' ? '看板视图' : '列表视图'} actions={actions}>
      <QuickComposer projectId={projectId} onDone={fetch} />

      {viewMode === 'list' && (
        <>
          {unsectioned.map(t => <TaskRow key={t.id} task={t} onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} onToggle={fetch} />)}
          {sections.map(s => {
            const ts = tasks.filter(t => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed)
            return (
              <div key={s.id} style={{ marginTop: 18 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1.5px solid var(--border)', paddingBottom: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', flex: 1 }}>{s.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ts.length}</span>
                  <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={async () => { await api.deleteSection(s.id); fetch() }}><Icon name="trash" size={12} /></button>
                </div>
                {ts.map(t => <TaskRow key={t.id} task={t} onClick={() => openTask(t)} onAIClick={() => openAI(t)} onDelete={fetch} onToggle={fetch} />)}
                <QuickComposer projectId={projectId} sectionId={s.id} autoFocus={false} onDone={fetch} />
              </div>
            )
          })}
          <div style={{ marginTop: 16 }}>
            {newSec ? (
              <input autoFocus value={newSecName} onChange={e => setNewSecName(e.target.value)}
                onKeyDown={async e => { if (e.key === 'Enter' && newSecName.trim()) { await api.addSection(projectId, newSecName.trim()); setNewSecName(''); setNewSec(false); fetch() } }}
                placeholder="分区名称…" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', width: '100%' }} />
            ) : (
              <button className="btn-ghost" style={{ color: 'var(--text-tertiary)' }} onClick={() => setNewSec(true)}><Icon name="plus" size={14} /> 添加分区</button>
            )}
          </div>
        </>
      )}

      {viewMode === 'board' && (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
          {unsectioned.length > 0 && <BoardCol section={null} tasks={unsectioned} onOpenTask={openTask} projectId={projectId} onRefresh={fetch} dragRef={boardDrag} handleDownRef={boardHandleDown} />}
          {sections.map(s => {
            const ts = tasks.filter(t => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed)
            return <BoardCol key={s.id} section={s} tasks={ts} onOpenTask={openTask} projectId={projectId} onRefresh={fetch} dragRef={boardDrag} handleDownRef={boardHandleDown} />
          })}
          <div style={{ width: 260, flex: 'none' }}>
            <input value={newColName} onChange={e => setNewColName(e.target.value)}
              onKeyDown={async e => { if (e.key === 'Enter' && newColName.trim()) { await api.addSection(projectId, newColName.trim()); setNewColName(''); fetch() } }}
              placeholder="+ 新建分区" style={{ width: '100%', border: '1.5px dashed var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 13.5, background: 'transparent', color: 'var(--text-secondary)', outline: 'none' }} />
          </div>
        </div>
      )}

      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || projectId} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </ViewShell>
  )
}

/* ============ BoardCol/BoardCard for project view ============ */
function BoardCard({ task, sectionId, onOpenTask, dragRef, handleDownRef, onRefresh }: {
  task: Task; sectionId: string | null; onOpenTask: (t: Task) => void;
  dragRef: React.MutableRefObject<DragState>; handleDownRef: React.MutableRefObject<boolean>; onRefresh: () => void;
}) {
  return (
    <div data-task-id={task.id} className="board-card" draggable
      onDragStart={e => { if (!handleDownRef.current) { e.preventDefault(); return } dragRef.current.taskId = task.id; dragRef.current.fromSection = sectionId; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { (e.target as HTMLElement).style.opacity = '0.4' }, 0) }}
      onDragEnd={e => { handleDownRef.current = false; dragRef.current.taskId = null; (e.target as HTMLElement).style.opacity = '1' }}
      onClick={() => onOpenTask(task)} style={{ position: 'relative', paddingLeft: 44 }}>
      <span className="board-drag-handle" onMouseDown={e => { e.stopPropagation(); handleDownRef.current = true }} onMouseUp={() => { handleDownRef.current = false }}
        style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'grab', fontSize: 13, lineHeight: 1, color: 'transparent', userSelect: 'none', transition: 'color .12s' }}>⠿</span>
      <div style={{ position: 'absolute', left: 22, top: '50%', transform: 'translateY(-50%)' }} onMouseDown={e => e.stopPropagation()}>
        <TaskCheckbox task={task} onToggle={onRefresh} />
      </div>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: parseTaskLabels(task.labels).length || task.due_date ? 8 : 0, lineHeight: 1.45 }}>{task.title}</div>
      <TaskChips task={task} />
    </div>
  )
}

function BoardCol({ section, tasks, onOpenTask, projectId, onRefresh, dragRef, handleDownRef }: {
  section: Section | null; tasks: Task[]; onOpenTask: (t: Task) => void;
  projectId: string; onRefresh: () => void; dragRef: React.MutableRefObject<DragState>; handleDownRef: React.MutableRefObject<boolean>;
}) {
  const [addingCard, setAddingCard] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [insertBefore, setInsertBefore] = useState<string | null>(null)
  const colRef = useRef<HTMLDivElement>(null)
  const sectionId = section ? section.id : null

  const getInsertTarget = (clientY: number) => {
    if (!colRef.current) return 'end'; const cards = [...colRef.current.querySelectorAll('[data-task-id]')]
    for (const card of cards) { const r = card.getBoundingClientRect(); if (clientY < r.top + r.height / 2) return (card as HTMLElement).dataset.taskId || null }
    return 'end'
  }

  return (
    <div className="board-col" ref={colRef}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(true); setInsertBefore(getInsertTarget(e.clientY)) }}
      onDragLeave={e => { if (!colRef.current?.contains(e.relatedTarget as Node)) { setDragOver(false); setInsertBefore(null) } }}
      onDrop={async e => { e.preventDefault(); setDragOver(false); setInsertBefore(null); const tid = dragRef.current.taskId; if (!tid) return
        const tasksInCol = tasks.filter(t => t.id !== tid); let no: number
        if (insertBefore === 'end' || !insertBefore) no = tasksInCol.length > 0 ? Math.max(...tasksInCol.map(t => t.sort_order)) + 1 : 0
        else { const idx = tasksInCol.findIndex(t => t.id === insertBefore); no = idx === 0 ? tasksInCol[0].sort_order - 1 : (idx > 0 ? (tasksInCol[idx - 1].sort_order + tasksInCol[idx].sort_order) / 2 : 0) }
        await api.updateTask(tid, { section_id: sectionId, sort_order: no } as any); onRefresh()
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '2px 0' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{section ? section.name : '未分区'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
        <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setAddingCard(true)}><Icon name="plus" size={14} /></button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minHeight: 40, borderRadius: 10, padding: dragOver ? '4px' : '0', background: dragOver ? 'var(--bg-hover)' : 'transparent', border: dragOver ? '1.5px dashed var(--border)' : '1.5px solid transparent', transition: 'all .12s' }}>
        {addingCard && <div className="board-card" style={{ padding: 8 }}><QuickComposer projectId={projectId} sectionId={sectionId || undefined} placeholder="任务名称…" autoFocus onDone={() => { setAddingCard(false); onRefresh() }} /></div>}
        {tasks.map(t => (<div key={t.id}>{insertBefore === t.id && dragOver && <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />}<BoardCard task={t} sectionId={sectionId} onOpenTask={onOpenTask} dragRef={dragRef} handleDownRef={handleDownRef} onRefresh={onRefresh} /></div>))}
        {insertBefore === 'end' && dragOver && <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />}
        {!addingCard && <button className="btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--text-tertiary)', fontSize: 13 }} onClick={() => setAddingCard(true)}><Icon name="plus" size={13} /> 添加任务</button>}
      </div>
    </div>
  )
}
