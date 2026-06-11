import { api } from '../api'
import { DateU } from '../utils/date'

interface BulkActionBarProps {
  ids: string[]
  onDone: () => void
  onClear: () => void
}

export function BulkActionBar({ ids, onDone, onClear }: BulkActionBarProps) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center',
      gap: 10, boxShadow: '0 4px 20px rgba(0,0,0,.15)', zIndex: 500,
    }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>已选 {ids.length} 条</span>
      <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={async () => {
        await api.bulkUpdate(ids, { completed: 1, completed_at: new Date().toISOString() } as any)
        onDone()
      }}>✓ 全部完成</button>
      <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={async () => {
        await api.bulkUpdate(ids, { priority: 1 } as any)
        onDone()
      }}>P1</button>
      <select style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', background: 'var(--bg-card)', color: 'var(--text-secondary)', outline: 'none' }}
        onChange={async (e) => {
          if (!e.target.value) return
          await api.bulkUpdate(ids, { due_date: e.target.value } as any)
          onDone()
        }}>
        <option value="">设置截止…</option>
        <option value={DateU.today()}>今天</option>
        <option value={DateU.addDays(DateU.today(), 1)}>明天</option>
        <option value={DateU.addDays(DateU.today(), 7)}>下周</option>
      </select>
      <button className="btn-ghost" style={{ color: 'var(--p1)', fontSize: 12.5 }} onClick={async () => {
        await Promise.all(ids.map(id => api.deleteTask(id)))
        onDone()
      }}>删除</button>
      <button className="btn-icon" onClick={onClear} style={{ width: 24, height: 24, fontSize: 14 }}>✕</button>
    </div>
  )
}
