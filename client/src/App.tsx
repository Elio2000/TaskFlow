import { useState, useEffect, useCallback } from 'react'
import type { Task } from './api'
import { api } from './api'
import { Sidebar } from './components/Sidebar'
import { SearchOverlay } from './components/SearchOverlay'
import { TaskModal } from './components/TaskModal'
import { PlannerBox } from './ai/PlannerBox'
import { TodayView, InboxView, UpcomingView, CalendarView } from './views/Views'
import { ProjectView } from './views/ProjectView'
import { SprintView } from './views/SprintView'
import { LabelView } from './views/LabelView'
import { Icon } from './icons'
import './style.css'

function useHotkeys(handlers: Record<string, () => void>) {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const key = (e.metaKey || e.ctrlKey ? 'mod+' : '') + (e.shiftKey ? 'shift+' : '') + e.key.toLowerCase()
      if (handlers[key]) { e.preventDefault(); handlers[key]() }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [handlers])
}

export default function App() {
  const [theme, setTheme] = useState('light')
  const [route, setRoute] = useState<{ view: string; projectId?: string }>({ view: 'today' })
  const [collapsed, setCollapsed] = useState(false)
  const [taskModal, setTaskModal] = useState<string | null>(null)
  const [plannerOpen, setPlannerOpen] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])

  // Load theme from API on mount
  useEffect(() => {
    api.getSetting('theme').then(({ value }) => {
      if (value) { setTheme(value); document.documentElement.setAttribute('data-theme', value) }
    }).catch(() => {})
  }, [])

  // Theme: sync to DOM
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next)
    api.setSetting('theme', next)
  }

  // Fetch tasks
  const fetchTasks = useCallback(async () => {
    const all = await api.getTasks()
    setTasks(all)
  }, [])

  useEffect(() => {
    fetchTasks()
    const id = setInterval(fetchTasks, 5000)
    return () => clearInterval(id)
  }, [fetchTasks])

  useHotkeys({
    'mod+k': () => setShowSearch(true),
    'mod+/': () => setPlannerOpen((o) => !o),
    't': () => setRoute({ view: 'today' }),
    'i': () => setRoute({ view: 'inbox' }),
    'u': () => setRoute({ view: 'upcoming' }),
    'c': () => setRoute({ view: 'calendar' }),
  })

  const openTask = (task: Task) => setTaskModal(task.id)
  const curProjectId = route.projectId || 'inbox'

  const viewContent = () => {
    switch (route.view) {
      case 'inbox': return <InboxView />
      case 'today': return <TodayView />
      case 'upcoming': return <UpcomingView />
      case 'calendar': return <CalendarView />
      case 'project': return <ProjectView projectId={route.projectId || 'inbox'} />
      case 'sprint': return <SprintView />
      case 'label': return <LabelView labelId={route.projectId || ''} />
      default: return <TodayView />
    }
  }

  return (
    <div data-theme={theme} style={{ display: 'flex', height: '100vh', background: 'var(--bg-content)' }}>
      <Sidebar route={route} setRoute={setRoute} collapsed={collapsed} setCollapsed={setCollapsed} tasks={tasks} onToggleTheme={toggleTheme} theme={theme} />

      <div style={{ flex: 1, display: 'flex', minWidth: 0, flexDirection: 'column' }}>
        <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-content)', flexShrink: 0 }}>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setShowSearch(true)}>
            <Icon name="search" size={15} /> 搜索
            <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4, marginLeft: 6 }}>⌘K</kbd>
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn-ghost" style={{ fontSize: 13 }} title="切换主题" onClick={toggleTheme}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
          </button>
        </div>

        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg-content)' }}>
            {viewContent()}
          </div>
        </div>
      </div>

      {!plannerOpen && (
        <button className="ai-fab" title="AI 规划 (⌘/)" onClick={() => setPlannerOpen(true)}>
          <Icon name="sparkle" size={22} />
        </button>
      )}

      {plannerOpen && (
        <PlannerBox defaultProjectId={curProjectId} onClose={() => setPlannerOpen(false)} onApplied={fetchTasks} />
      )}

      {taskModal && <TaskModal taskId={taskModal} onClose={() => { setTaskModal(null); fetchTasks() }} />}

      {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} onOpenTask={openTask} />}
    </div>
  )
}
