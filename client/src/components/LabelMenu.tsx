import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Label } from '../api'
import { Icon } from '../icons'
import { Popover } from './Popover'

interface LabelMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  selected: string[]
  onToggle: (id: string) => void
}

export function LabelMenu({ anchorRef, onClose, selected, onToggle }: LabelMenuProps) {
  const [labels, setLabels] = useState<Label[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    api.getLabels().then(setLabels).catch(() => setLabels([]))
  }, [])

  const shown = labels.filter((l) => l.name.includes(q))

  const handleCreateAndToggle = async () => {
    try {
      const l = await api.addLabel(q)
      setLabels((prev) => [...prev, l])
      onToggle(l.id)
      setQ('')
    } catch {
      // ignore
    }
  }

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={220}>
      <div style={{ padding: 6 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索或新建标签"
          style={{
            width: '100%',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '6px 9px',
            fontSize: 13,
            background: 'var(--bg-content)',
            outline: 'none',
            marginBottom: 4,
          }}
        />
        {shown.map((l) => (
          <button key={l.id} className="menu-item" onClick={() => onToggle(l.id)}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: l.color,
                flex: 'none',
              }}
            />
            {l.name}
            {selected.includes(l.id) && (
              <span className="menu-hint">
                <Icon name="check" size={14} />
              </span>
            )}
          </button>
        ))}
        {q && !labels.some((l) => l.name === q) && (
          <button
            className="menu-item"
            style={{ color: 'var(--accent-text)' }}
            onClick={handleCreateAndToggle}
          >
            <Icon name="plus" size={14} /> 新建「{q}」
          </button>
        )}
      </div>
    </Popover>
  )
}
