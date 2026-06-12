import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Task, Label } from '../api'
import { TaskRow } from '../components/TaskRow'
import { TaskModal } from '../components/TaskModal'
import { AIPanel } from '../ai/AIPanel'

export function LabelView({ labelId }: { labelId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [label, setLabel] = useState<Label | null>(null)
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task | null>(null)

  const fetch = async () => {
    const [ts, lbs] = await Promise.all([api.getTasks(), api.getLabels()])
    const lbl = lbs.find(l => l.id === labelId) || null
    setLabel(lbl)
    // Filter tasks that have this label
    const filtered = ts.filter(t => {
      try {
        const ids: string[] = JSON.parse(t.labels || '[]')
        return ids.includes(labelId)
      } catch { return false }
    })
    setTasks(filtered)
  }

  useEffect(() => { fetch(); const id = setInterval(fetch, 5000); return () => clearInterval(id) }, [labelId])

  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
          # {label?.name || '标签'} <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-tertiary)' }}>{tasks.length} 条任务</span>
        </h1>
      </div>
      <div style={{ padding: '20px 32px 32px' }}>
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>暂无任务</div>
            <div style={{ fontSize: 13 }}>创建任务时输入 #标签名 即可为任务打标签</div>
          </div>
        ) : (
          tasks.map(t => <TaskRow key={t.id} task={t} showProject onClick={() => setTaskModal(t.id)} onAIClick={task => { setAiTask(task); setAiOpen(true) }} onDelete={fetch} onToggle={fetch} />)
        )}
      </div>
      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetch() }} />}
      {aiOpen && <AIPanel projectId={aiTask?.project_id || 'inbox'} refTask={aiTask} layout="float" onClose={() => setAiOpen(false)} />}
    </div>
  )
}
