import { useState, useEffect, useRef, ReactNode } from 'react'
import { api } from '../api'
import type { Task, Project, Label } from '../api'
import { DateU } from '../utils/date'
import { Icon, PRIORITY_META } from '../icons'
import { parse } from '../nlp'
import { TaskCheckbox } from '../components/TaskCheckbox'
import { TaskChips } from '../components/TaskChips'

/* ====================================================
   ViewShell — 视图包装
   ==================================================== */
function ViewShell({ title, subtitle, children }: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{title}</h1>
        {subtitle && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>{subtitle}</div>}
      </div>
      <div style={{ padding: '20px 32px 32px' }}>
        {children}
      </div>
    </div>
  )
}

/* ====================================================
   EmptyState — 空状态
   ==================================================== */
function EmptyState({ icon, text, sub }: { icon: string; text: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)' }}>
      <Icon name={icon} size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: 0.5 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{text}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  )
}

/* ====================================================
   TaskRow — 通用任务行
   ==================================================== */
function TaskRow({ task, onClick }: { task: Task; onClick?: (task: Task) => void }) {
  return (
    <div className={'task-row' + (task.completed ? ' is-done' : '')} onClick={() => onClick && onClick(task)}>
      <TaskCheckbox task={task} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title">{task.title}</div>
        <TaskChips task={task} />
      </div>
      <div className="task-actions" style={{ display: 'flex', gap: 2, paddingTop: 2 }}>
        <button className="btn-icon" style={{ width: 26, height: 26 }}
          onClick={(e) => { e.stopPropagation() }}
          title="删除">
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  )
}

/* ====================================================
   QuickComposer — NLP 快速添加
   ==================================================== */
interface NLPResult {
  title: string
  due_date: string | null
  due_time: string | null
  priority: number | null
  project_id: string | null
  label_ids: string[]
  repeat: string | null
}

function QuickComposer({ projectId, placeholder, onDone }: {
  projectId: string
  placeholder?: string
  onDone?: (task: Task | null) => void
}) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<NLPResult | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {})
    api.getLabels().then(setLabels).catch(() => {})
  }, [])

  useEffect(() => {
    if (text.trim()) {
      setParsed(parse(text, { projects, labels }))
    } else {
      setParsed(null)
    }
  }, [text, projects, labels])

  const submit = async () => {
    if (!parsed || !parsed.title) return
    try {
      const task = await api.addTask({
        title: parsed.title,
        project_id: parsed.project_id || projectId || 'inbox',
        section_id: null,
        due_date: parsed.due_date ?? undefined as any,
        due_time: parsed.due_time ?? undefined as any,
        priority: parsed.priority || 4,
        labels: JSON.stringify(parsed.label_ids),
        repeat: parsed.repeat ?? undefined as any,
      })
      setText('')
      if (onDone) onDone(task)
    } catch { /* ignore */ }
  }

  const TokenPreview = () => {
    if (!parsed || !text) return null
    const chips: { color: string; bg: string; text: string }[] = []
    if (parsed.due_date) {
      chips.push({
        color: 'var(--accent-text)',
        bg: 'var(--accent-soft)',
        text: DateU.human(parsed.due_date) + (parsed.due_time ? ' ' + parsed.due_time : ''),
      })
    }
    if (parsed.repeat) {
      chips.push({
        color: 'var(--accent-text)',
        bg: 'var(--accent-soft)',
        text: ({ daily: '每天', weekly: '每周', monthly: '每月' } as Record<string, string>)[parsed.repeat],
      })
    }
    if (parsed.priority && parsed.priority < 4) {
      chips.push({
        color: PRIORITY_META[parsed.priority].color,
        bg: 'var(--bg-inset)',
        text: 'P' + parsed.priority,
      })
    }
    if (parsed.project_id) {
      const p = projects.find((pr) => pr.id === parsed.project_id)
      if (p) chips.push({ color: 'var(--ai)', bg: 'var(--ai-soft)', text: p.name })
    }
    parsed.label_ids.forEach((id) => {
      const l = labels.find((lb) => lb.id === id)
      if (l) chips.push({ color: 'var(--p3)', bg: 'rgba(91,127,166,.13)', text: l.name })
    })
    if (!chips.length) return null
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 12px 8px' }}>
        {chips.map((c, i) => (
          <span key={i} style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.color, fontWeight: 500 }}>{c.text}</span>
        ))}
      </div>
    )
  }

  return (
    <div className="composer" style={{ margin: '0 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 8px 12px' }}>
        <Icon name="plus" size={16} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { submit() }
            if (e.key === 'Escape') { setText(''); if (onDone) onDone(null) }
          }}
          placeholder={placeholder || '添加任务… 试试「明天下午3点 #论文写作 p2」'}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 14, color: 'var(--text-primary)', minWidth: 0 }}
        />
        {text && (
          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12.5 }} onClick={submit}>添加</button>
        )}
      </div>
      <TokenPreview />
      {text && (
        <div style={{ display: 'flex', gap: 6, padding: '0 12px 8px', borderTop: '1px solid var(--border-soft)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            <kbd style={{ background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--mono)', fontSize: 11 }}>Enter</kbd> 添加
            &nbsp;&nbsp;
            <kbd style={{ background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--mono)', fontSize: 11 }}>Esc</kbd> 取消
          </span>
        </div>
      )}
    </div>
  )
}

/* ====================================================
   InboxView — 收件箱视图
   ==================================================== */
interface InboxViewProps {
  onOpenTask?: (task: Task) => void
}

export function InboxView({ onOpenTask }: InboxViewProps) {
  const [tasks, setTasks] = useState<Task[]>([])

  const loadTasks = () => {
    api.getTasks({ project_id: 'inbox' })
      .then((data) => setTasks(data.filter((t) => !t.parent_id && !t.completed)))
      .catch(() => {})
  }

  useEffect(() => {
    loadTasks()
    const timer = setInterval(loadTasks, 5000)
    return () => clearInterval(timer)
  }, [])

  const handleDone = (task: Task | null) => {
    if (task) loadTasks()
  }

  return (
    <ViewShell title="收件箱" subtitle={tasks.length ? tasks.length + ' 条任务' : '干净如新'}>
      <QuickComposer projectId="inbox" placeholder="添加到收件箱… 试试「明天 p2 整理文件」" onDone={handleDone} />
      {tasks.length === 0
        ? <EmptyState icon="inbox" text="收件箱已清空" sub="处理完所有任务，真不错！" />
        : tasks.map((t) => <TaskRow key={t.id} task={t} onClick={onOpenTask} />)
      }
    </ViewShell>
  )
}
