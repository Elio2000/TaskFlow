import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task, Project, Label } from '../api'
import { DateU } from '../utils/date'
import { Icon, PRIORITY_META } from '../icons'
import { parse } from '../nlp'

interface QuickComposerProps {
  projectId: string
  sectionId?: string
  onDone?: (task?: Task) => void
  placeholder?: string
  autoFocus?: boolean
  defaultDueDate?: string
  collapsed?: boolean
  collapsedLabel?: string
}

const REPEAT_LABELS: Record<string, string> = {
  daily: '每天',
  weekly: '每周',
  monthly: '每月',
}

export function QuickComposer({ projectId, sectionId, onDone, placeholder, autoFocus, defaultDueDate, collapsed, collapsedLabel }: QuickComposerProps) {
  const [text, setText] = useState('')
  const [parsed, setParsed] = useState<ReturnType<typeof parse> | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(!collapsed)
  const [showConfirm, setShowConfirm] = useState(false)
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
    setLoading(true)
    try {
      // Resolve label names to IDs
      const allLabels = await api.getLabels()
      const labelIds: string[] = []
      for (const name of (parsed.label_ids || [])) {
        let lbl = allLabels.find(l => l.name === name)
        if (!lbl) {
          const colors = ['#c25e4c','#c98a2e','#5b7fa6','#7a9461','#8a6fa8']
          lbl = await api.addLabel(name, colors[Math.floor(Math.random() * colors.length)])
        }
        labelIds.push(lbl.id)
      }

      const body: Record<string, any> = {
        title: parsed.title,
        project_id: parsed.project_id || projectId || 'inbox',
        priority: parsed.priority || 4,
        labels: labelIds,
      }
      if (sectionId) body.section_id = sectionId
      if (parsed.due_date) body.due_date = parsed.due_date
      else if (defaultDueDate) body.due_date = defaultDueDate
      if (parsed.due_time) body.due_time = parsed.due_time
      if (parsed.repeat) body.repeat = parsed.repeat

      const task = await api.addTask(body as any)
      setText('')
      setExpanded(false)
      if (onDone) onDone(task)
    } catch (err) {
      console.error('Failed to add task:', err)
    } finally {
      setLoading(false)
    }
  }

  const findProject = (id: string) => projects.find((p) => p.id === id)
  const findLabel = (id: string) => labels.find((l) => l.id === id)

  const chips: { color: string; bg: string; text: string }[] = []
  if (parsed && text) {
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
        text: REPEAT_LABELS[parsed.repeat] || parsed.repeat,
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
      const p = findProject(parsed.project_id)
      if (p) {
        chips.push({ color: 'var(--ai)', bg: 'var(--ai-soft)', text: p.name })
      }
    }
    parsed.label_ids.forEach((id) => {
      const l = findLabel(id)
      if (l) {
        chips.push({
          color: 'var(--p3)',
          bg: 'rgba(91,127,166,.13)',
          text: l.name,
        })
      }
    })
  }

  const handleCancel = () => {
    if (text.trim() || (parsed && parsed.title)) {
      setShowConfirm(true)
    } else {
      setText(''); setExpanded(false)
    }
  }

  const handleDiscard = () => {
    setText(''); setExpanded(false); setShowConfirm(false)
  }

  if (!expanded && collapsed) {
    return (
      <button className="btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--text-secondary)', fontSize: 13, width: '100%', marginBottom: 12 }}
        onClick={() => setExpanded(true)}>
        <Icon name="plus" size={14} style={{ color: 'var(--accent)' }} /> {collapsedLabel || '添加任务'}
      </button>
    )
  }

  return (
    <div className="composer" style={{ margin: '0 0 16px' }}>
      {showConfirm && (
        <div className="modal-scrim" style={{ zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowConfirm(false) }}>
          <div className="modal-card" style={{ maxWidth: 320, marginTop: '20vh', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>放弃未保存的修改？</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>您输入的内容将不会被保存。</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="btn-primary" style={{ background: 'var(--p1)' }} onClick={handleDiscard}>放弃</button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 8px 12px' }}>
        <Icon name="plus" size={16} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !loading) {
              if (e.shiftKey) {
                e.preventDefault()
                submit()
              } else {
                e.preventDefault()
                submit()
              }
            }
            if (e.key === 'Escape') {
              handleCancel()
            }
          }}
          placeholder={placeholder || '添加任务… 试试「明天下午3点 #论文写作 p2」'}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'none',
            fontSize: 14,
            color: 'var(--text-primary)',
            minWidth: 0,
          }}
        />
        {text && (
          <button
            className="btn-primary"
            style={{ padding: '4px 12px', fontSize: 12.5 }}
            onClick={submit}
            disabled={loading}
          >
            添加
          </button>
        )}
      </div>

      {chips.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 12px 8px' }}>
          {chips.map((c, i) => (
            <span
              key={i}
              style={{
                fontSize: 11.5,
                padding: '2px 7px',
                borderRadius: 5,
                background: c.bg,
                color: c.color,
                fontWeight: 500,
              }}
            >
              {c.text}
            </span>
          ))}
        </div>
      )}

      {text && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '0 12px 8px',
            borderTop: '1px solid var(--border-soft)',
          }}
        >
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            <kbd
              style={{
                background: 'var(--bg-inset)',
                borderRadius: 4,
                padding: '1px 5px',
                fontFamily: 'var(--mono)',
                fontSize: 11,
              }}
            >
              Enter
            </kbd>{' '}
            添加
            &nbsp;&nbsp;
            <kbd
              style={{
                background: 'var(--bg-inset)',
                borderRadius: 4,
                padding: '1px 5px',
                fontFamily: 'var(--mono)',
                fontSize: 11,
              }}
            >
              ⇧ Enter
            </kbd>{' '}
            添加并编辑
            &nbsp;&nbsp;
            <kbd
              style={{
                background: 'var(--bg-inset)',
                borderRadius: 4,
                padding: '1px 5px',
                fontFamily: 'var(--mono)',
                fontSize: 11,
              }}
            >
              Esc
            </kbd>{' '}
            取消
          </span>
        </div>
      )}
    </div>
  )
}
