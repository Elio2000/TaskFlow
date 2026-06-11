import { useState } from 'react'
import { api } from '../api'
import type { Task } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { TaskCheckbox } from './TaskCheckbox'

interface SearchOverlayProps {
  onClose: () => void
  onOpenTask: (task: Task) => void
}

export function SearchOverlay({ onClose, onOpenTask }: SearchOverlayProps) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)

  const search = async (query: string) => {
    setQ(query)
    if (query.length <= 1) { setResults([]); return }
    setLoading(true)
    const all = await api.getTasks()
    const filtered = all.filter(t =>
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      (t.description || '').toLowerCase().includes(query.toLowerCase())
    ).slice(0, 12)
    setResults(filtered)
    setLoading(false)
  }

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose() }} style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div className="modal-card" style={{ width: 'min(580px, 92vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' }}>
          <Icon name="search" size={18} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
          <input autoFocus value={q} onChange={(e) => search(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && results[0]) { onOpenTask(results[0]); onClose() } }}
            placeholder="搜索任务…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 16, color: 'var(--text-primary)' }} />
          <kbd style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', padding: '2px 7px', borderRadius: 5 }}>Esc</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: q ? '6px' : '0' }}>
          {loading && <div style={{ padding: '20px 16px', color: 'var(--text-tertiary)', fontSize: 13.5, textAlign: 'center' }}>搜索中...</div>}
          {!loading && q.length > 1 && results.length === 0 && <div style={{ padding: '20px 16px', color: 'var(--text-tertiary)', fontSize: 13.5, textAlign: 'center' }}>没有找到「{q}」</div>}
          {results.map((t) => (
            <button key={t.id} className="menu-item" style={{ borderRadius: 8 }}
              onClick={() => { onOpenTask(t); onClose() }}>
              <TaskCheckbox task={t} />
              <span style={{ flex: 1, fontSize: 13.5, color: t.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: t.completed ? 'line-through' : 'none' }}>{t.title}</span>
              {t.due_date && <span style={{ fontSize: 12, color: DateU.isOverdue(t.due_date) ? 'var(--p1)' : 'var(--text-tertiary)' }}>{DateU.human(t.due_date)}</span>}
            </button>
          ))}
        </div>
        {!q && (
          <div style={{ padding: '16px', fontSize: 12.5, color: 'var(--text-tertiary)', textAlign: 'center' }}>输入关键词搜索任务</div>
        )}
      </div>
    </div>
  )
}
