import { Popover } from './Popover'
import { Icon, PRIORITY_META } from '../icons'

interface PriorityMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>
  onPick: (priority: number) => void
  onClose: () => void
}

export function PriorityMenu({ anchorRef, onPick, onClose }: PriorityMenuProps) {
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={170}>
      <div style={{ padding: 6 }}>
        {[1, 2, 3, 4].map((p) => (
          <button key={p} className="menu-item" onClick={() => onPick(p)}>
            <Icon name="flag" size={15} style={{ color: PRIORITY_META[p].color }} />
            {PRIORITY_META[p].name}
            <span className="menu-hint">p{p}</span>
          </button>
        ))}
      </div>
    </Popover>
  )
}
