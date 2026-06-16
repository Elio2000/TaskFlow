import { useState, useEffect } from 'react'
import { api } from '../api'
import type { Project } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { SettingsModal } from './SettingsModal'

const PROJECT_COLORS = ['#c25e4c','#c98a2e','#5b7fa6','#7a9461','#8a6fa8','#4a7fa8','#c26e3a']

function ColorDot({ color, size = 9 }: { color: string; size?: number }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' }} />
}

function LabelsSection({ route, setRoute }: { route: { view: string; projectId?: string }; setRoute: (r: { view: string; projectId?: string }) => void }) {
  const [labels, setLabels] = useState<any[]>([])
  useEffect(() => { api.getLabels().then(setLabels); const id = setInterval(() => api.getLabels().then(setLabels), 10000); return () => clearInterval(id) }, [])
  if (!labels.length) return null
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px 6px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: .05, flex: 1 }}>标签</span>
      </div>
      {labels.slice(0, 10).map((l: any) => {
        const isActive = route.view === 'label' && route.projectId === l.id
        return (
          <button key={l.id} className={'side-item' + (isActive ? ' is-active' : '')}
            onClick={() => setRoute({ view: 'label', projectId: l.id })}
            style={{ width: '100%' }}>
            <span style={{ color: l.color, fontWeight: 700, flex: 'none' }}>#</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{l.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function CyclesSection({ route, setRoute }: { route: { view: string; projectId?: string }; setRoute: (r: { view: string; projectId?: string }) => void }) {
  const [cycles, setCycles] = useState<any[]>([])
  useEffect(() => { api.getCycles().then(setCycles); const id = setInterval(() => api.getCycles().then(setCycles), 10000); return () => clearInterval(id) }, [])
  const today = new Date().toISOString().slice(0, 10)
  const active = cycles.filter((c: any) => c.start_date <= today && c.end_date >= today)
  if (!active.length && !cycles.length) return null

  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px 6px' }}>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: .05, flex: 1 }}>冲刺</span>
      </div>
      {active.map((c: any) => {
        const isActive = route.view === 'cycle' && route.projectId === c.id
        return (
          <button key={c.id} className={'side-item' + (isActive ? ' is-active' : '')}
            onClick={() => setRoute({ view: 'cycle', projectId: c.id })}
            style={{ width: '100%' }}>
            <Icon name="flag" size={14} style={{ color: 'var(--green)', flex: 'none' }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{c.name}</span>
          </button>
        )
      })}
    </div>
  )
}

interface SidebarProps {
  route: { view: string; projectId?: string }
  setRoute: (r: { view: string; projectId?: string }) => void
  collapsed: boolean
  setCollapsed: (c: boolean) => void
  tasks: any[]
  onToggleTheme?: () => void
  theme?: string
}

export function Sidebar({ route, setRoute, collapsed, setCollapsed, tasks, onToggleTheme, theme }: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [addingProject, setAddingProject] = useState(false)
  const [newProjName, setNewProjName] = useState('')
  const [pickColor, setPickColor] = useState(PROJECT_COLORS[0])
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    api.getProjects().then(setProjects)
    const id = setInterval(() => api.getProjects().then(setProjects), 5000)
    return () => clearInterval(id)
  }, [])

  const inboxCount = tasks.filter(t => t.project_id === 'inbox' && !t.completed && !t.parent_id).length
  const todayCount = tasks.filter(t =>
    !t.completed && !t.parent_id &&
    (t.due_date === DateU.today() || (t.due_date && DateU.isOverdue(t.due_date)))
  ).length

  const navItems = [
    { id: 'inbox', label: '收件箱', icon: 'inbox', count: inboxCount },
    { id: 'today', label: '今天', icon: 'today', count: todayCount },
    { id: 'upcoming', label: '即将到来', icon: 'upcoming' },
    { id: 'calendar', label: '日历', icon: 'calendar' },
  ]

  const createProject = async () => {
    if (!newProjName.trim()) { setAddingProject(false); return }
    const p = await api.addProject(newProjName.trim(), pickColor)
    setProjects(prev => [...prev, p])
    setRoute({ view: p.view_mode === 'board' ? 'board' : 'list', projectId: p.id })
    setNewProjName(''); setPickColor(PROJECT_COLORS[0]); setAddingProject(false)
  }

  if (collapsed) {
    return (
      <div style={{ width: 52, background: 'var(--bg-app)', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 4, flexShrink: 0 }}>
        <button className="btn-icon" onClick={() => setCollapsed(false)} title="展开侧栏"><Icon name="sidebar" size={18} /></button>
        <div style={{ width: 1, height: 12 }} />
        {navItems.map((n) => (
          <button key={n.id} className={'btn-icon' + (route.view === n.id ? ' is-active' : '')}
            style={{ width: 38, height: 38, borderRadius: 9, position: 'relative', color: route.view === n.id ? 'var(--accent-text)' : 'var(--text-secondary)' }}
            title={n.label} onClick={() => setRoute({ view: n.id })}>
            <Icon name={n.icon} size={17} />
            {n.count != null && n.count > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
          </button>
        ))}
      </div>
    )
  }

  return (
    <div style={{ width: 220, background: 'var(--bg-app)', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 8px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', paddingLeft: 4, letterSpacing: -.2 }}>TaskFlow</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="btn-icon" title="收起侧栏" onClick={() => setCollapsed(true)}><Icon name="sidebar" size={16} /></button>
        </div>
      </div>

      <div style={{ padding: '0 8px', marginBottom: 12 }}>
        {navItems.map((n) => (
          <button key={n.id} className={'side-item' + (route.view === n.id ? ' is-active' : '')} onClick={() => setRoute({ view: n.id })}>
            <Icon name={n.icon} size={16} style={{ flex: 'none' }} />
            {n.label}
            {n.count != null && n.count > 0 && <span className="count">{n.count}</span>}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 8px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 6px', marginBottom: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: .05, flex: 1 }}>项目</span>
          <button className="btn-icon" style={{ width: 22, height: 22 }} title="新建项目" onClick={() => setAddingProject(true)}><Icon name="plus" size={14} /></button>
        </div>
        {projects.filter(p => !p.archived).map((p) => {
          const isActive = (route.view === 'project') && route.projectId === p.id
          const count = tasks.filter(t => t.project_id === p.id && !t.completed && !t.parent_id).length
          return (
            <button key={p.id} className={'side-item' + (isActive ? ' is-active' : '')}
              onClick={() => setRoute({ view: 'project', projectId: p.id })}>
              {p.id === 'inbox' ? <Icon name="inbox" size={15} style={{ flex: 'none' }} /> : <ColorDot color={p.color} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {count > 0 && <span className="count">{count}</span>}
            </button>
          )
        })}
        {addingProject && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginTop: 6 }}>
            <input autoFocus value={newProjName} onChange={(e) => setNewProjName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) createProject(); if (e.key === 'Escape') { setAddingProject(false); setNewProjName(''); } }}
              placeholder="项目名称"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 13, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {PROJECT_COLORS.map((c) => (
                <button key={c} onClick={() => setPickColor(c)}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: pickColor === c ? '2.5px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 12.5, padding: '5px 0' }} onClick={createProject}>创建</button>
              <button className="btn-outline" style={{ flex: 1, fontSize: 12.5, padding: '5px 0' }} onClick={() => { setAddingProject(false); setNewProjName(''); }}>取消</button>
            </div>
          </div>
        )}
        <CyclesSection route={route} setRoute={setRoute} />
        <LabelsSection route={route} setRoute={setRoute} />
      </div>

      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 2, marginTop: 12 }}>
        {onToggleTheme && (
          <button className="btn-icon" style={{ width: 32, height: 32, flex: 'none' }} title="切换主题" onClick={onToggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        )}
        <button className="btn-icon" style={{ width: 32, height: 32, flex: 'none' }} title="AI 设置" onClick={() => setShowSettings(true)}>
          <Icon name="brain" size={15} />
        </button>
        <button className="btn-ghost" style={{ flex: 1, justifyContent: 'flex-start', fontSize: 12.5 }}
          onClick={() => { const data = JSON.stringify({ projects, tasks: [] }); const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(data); a.download = 'taskflow-export.json'; a.click() }}>
          <Icon name="archive" size={14} /> 导出数据
        </button>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
