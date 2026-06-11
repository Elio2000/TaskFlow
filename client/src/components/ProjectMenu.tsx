import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Project, Section } from '../api'
import { Icon } from '../icons'
import { Popover } from './Popover'

interface ProjectMenuProps {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onPick: (projectId: string, sectionId: string | null) => void
}

export function ProjectMenu({ anchorRef, onClose, onPick }: ProjectMenuProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [sectionsMap, setSectionsMap] = useState<Record<string, Section[]>>({})

  useEffect(() => {
    void (async () => {
      const projs = await api.getProjects()
      setProjects(projs)
      const map: Record<string, Section[]> = {}
      await Promise.all(
        projs.map(async (p) => {
          map[p.id] = await api.getSections(p.id)
        }),
      )
      setSectionsMap(map)
    })()
  }, [])

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={240}>
      <div style={{ padding: 6 }}>
        {projects.map((p) => {
          const secs = sectionsMap[p.id] || []
          return (
            <div key={p.id}>
              <button className="menu-item" onClick={() => onPick(p.id, null)}>
                {p.id === 'inbox' ? (
                  <Icon name="inbox" size={15} />
                ) : (
                  <Icon name="hash" size={15} style={{ color: p.color }} />
                )}
                {p.name}
              </button>
              {secs.map((s) => (
                <button
                  key={s.id}
                  className="menu-item"
                  style={{ paddingLeft: 32, fontSize: 13, color: 'var(--text-secondary)' }}
                  onClick={() => onPick(p.id, s.id)}
                >
                  <Icon name="board" size={13} /> {s.name}
                </button>
              ))}
            </div>
          )
        })}
      </div>
    </Popover>
  )
}
