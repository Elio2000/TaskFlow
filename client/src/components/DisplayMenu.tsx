import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Label } from '../api'
import { Icon } from '../icons'

export interface DisplayFilters {
  labels: string[]      // selected label IDs
  priority: number | null // null = all, 1-4 = specific
  completed: boolean    // show completed
  sort: string          // 'manual' | 'due_date' | 'priority' | 'created'
}

interface DisplayMenuProps {
  filters: DisplayFilters
  onChange: (f: DisplayFilters) => void
  showLayout?: boolean
  layoutMode?: 'list' | 'board'
  onLayoutChange?: (m: 'list' | 'board') => void
}

export function DisplayMenu({ filters, onChange, showLayout, layoutMode, onLayoutChange }: DisplayMenuProps) {
  const [open, setOpen] = useState(false)
  const [labels, setLabels] = useState<Label[]>([])

  useEffect(() => { api.getLabels().then(setLabels) }, [])

  const toggleLabel = (id: string) => {
    const next = filters.labels.includes(id)
      ? filters.labels.filter(l => l !== id)
      : [...filters.labels, id]
    onChange({ ...filters, labels: next })
  }

  const resetAll = () => onChange({ labels: [], priority: null, completed: false, sort: 'manual' })

  if (!open) {
    return <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setOpen(true)}>
      <Icon name="filter" size={14} /> Display
    </button>
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setOpen(false)}>
        <Icon name="filter" size={14} /> Display
      </button>
      <div className="popover" style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, width: 260, zIndex: 100, padding: 8, maxHeight: '80vh', overflowY: 'auto' }}>
        {showLayout && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase' }}>Layout</div>
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 6, padding: 2 }}>
              {(['list', 'board'] as const).map(m => (
                <button key={m} onClick={() => onLayoutChange?.(m)}
                  style={{ flex: 1, fontSize: 12, padding: '4px 0', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: layoutMode === m ? 'var(--bg-card)' : 'transparent',
                    color: layoutMode === m ? 'var(--text-primary)' : 'var(--text-tertiary)', fontWeight: layoutMode === m ? 600 : 400 }}>
                  {m === 'list' ? '列表' : '看板'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase' }}>Priority</div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className={filters.priority === null ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => onChange({ ...filters, priority: null })}>All</button>
            {[1, 2, 3, 4].map(p => (
              <button key={p} className={filters.priority === p ? 'btn-primary' : 'btn-ghost'} style={{ fontSize: 11, padding: '3px 8px' }}
                onClick={() => onChange({ ...filters, priority: filters.priority === p ? null : p })}>P{p}</button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', marginBottom: 4, textTransform: 'uppercase' }}>
            Labels {filters.labels.length > 0 && `(${filters.labels.length})`}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {labels.map(l => {
              const active = filters.labels.includes(l.id)
              return (
                <button key={l.id} onClick={() => toggleLabel(l.id)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: `1px solid ${active ? l.color : 'var(--border)'}`,
                    background: active ? l.color + '22' : 'transparent', color: active ? l.color : 'var(--text-secondary)', cursor: 'pointer' }}>
                  {l.name}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12.5 }}>
            <input type="checkbox" checked={filters.completed} onChange={e => onChange({ ...filters, completed: e.target.checked })}
              style={{ accentColor: 'var(--accent)' }} />
            显示已完成任务
          </label>
        </div>

        <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}
          onClick={resetAll}>重置全部</button>
      </div>
    </div>
  )
}
