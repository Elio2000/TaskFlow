import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Task } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskModal } from '../components/TaskModal'
import { AIPanel } from '../ai/AIPanel'

export function CycleView({ cycleId }: { cycleId: string }) {
  const [cycle, setCycle] = useState<any>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [searchQ, setSearchQ] = useState('')

  const fetch = async () => {
    const cs = await api.getCycles()
    const c = cs.find((x: any) => x.id === cycleId)
    setCycle(c || null)
    if (c) {
      const ts = await api.getCycleTasks(cycleId)
      setTasks(ts)
    }
  }
  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [cycleId])

  if (!cycle) return <div style={{ padding: 20 }}>加载中...</div>

  const completed = tasks.filter(t => t.completed).length
  const progress = tasks.length > 0 ? Math.round(completed / tasks.length * 100) : 0
  const today = DateU.today()

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Icon name="flag" size={22} style={{ color: 'var(--green)' }} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{cycle.name}</h1>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 4 }}>
              {cycle.start_date} → {cycle.end_date}
              {cycle.start_date <= today && cycle.end_date >= today && (
                <span style={{ marginLeft: 8, color: 'var(--green)', fontWeight: 600 }}>● 活跃</span>
              )}
            </div>
          </div>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={async () => {
            const ts = await api.getTasks()
            setAllTasks(ts.filter((t: Task) => !t.completed && !t.parent_id))
            setShowPicker(true)
          }}><Icon name="plus" size={14} /> 添加已有任务</button>
        </div>
        {/* Task picker modal */}
        {showPicker && (
          <div className="modal-scrim" onClick={e => { if (e.target === e.currentTarget) setShowPicker(false) }}>
            <div className="modal-card" style={{ maxWidth: 480, marginTop: '10vh', maxHeight: '60vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
              <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)} placeholder="搜索任务…"
                  style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'none', color: 'var(--text-primary)' }} />
                <button className="btn-icon" onClick={() => setShowPicker(false)}><Icon name="x" size={16} /></button>
              </div>
              <div style={{ padding: 8 }}>
                {allTasks.filter(t => t.title.toLowerCase().includes(searchQ.toLowerCase()) && !tasks.find(ct => ct.id === t.id)).slice(0, 20).map(t => (
                  <button key={t.id} className="menu-item" style={{ width: '100%' }} onClick={async () => {
                    await api.addTaskToCycle(cycleId, t.id)
                    setShowPicker(false); setSearchQ(''); fetch()
                  }}>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>+ 加入冲刺</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {/* Progress bar */}
        <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: 'var(--bg-inset)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress}%`, background: 'var(--green)', borderRadius: 3, transition: 'width .3s' }} />
          </div>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{completed}/{tasks.length} ({progress}%)</span>
        </div>
      </div>
      <div style={{ padding: '20px 32px 32px', flex: 1 }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>暂无任务</div>
            <div style={{ fontSize: 13 }}>通过 API 或从其他视图把任务加入此冲刺</div>
          </div>
        ) : (
          tasks.map(t => (
            <TaskRow key={t.id} task={t} showProject onClick={() => setTaskModal(t.id)}
              onAIClick={task => { setAiTask(task); setAiOpen(true) }} onDelete={fetch} onToggle={fetch} />
          ))
        )}
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </div>
  )
}
