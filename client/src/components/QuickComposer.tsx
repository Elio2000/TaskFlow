import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task, Project, Label } from '../api'
import { DateU } from '../utils/date'
import { Icon, PRIORITY_META } from '../icons'
import { parse } from '../nlp'
import { DateMenu } from './DateMenu'
import { PriorityMenu } from './PriorityMenu'
import { LabelMenu } from './LabelMenu'

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

  // Explicit picker overrides — once the user picks a field, it wins over NLP.
  // null means "not set, fall back to NLP parse".
  const [manualDate, setManualDate] = useState<{ due_date: string | null; due_time: string | null; repeat: string | null } | null>(null)
  const [manualPriority, setManualPriority] = useState<number | null>(null)
  const [manualLabelIds, setManualLabelIds] = useState<string[] | null>(null)
  const [openMenu, setOpenMenu] = useState<null | 'date' | 'priority' | 'label'>(null)
  const dateRef = useRef<HTMLButtonElement>(null)
  const prioRef = useRef<HTMLButtonElement>(null)
  const labelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    api.getProjects().then(setProjects).catch(() => {})
    api.getLabels().then(setLabels).catch(() => {})
  }, [])

  useEffect(() => {
    setParsed(text.trim() ? parse(text, { projects, labels }) : null)
  }, [text, projects, labels])

  // Effective values: explicit pick wins, otherwise NLP parse, otherwise default.
  const effDueDate = manualDate ? manualDate.due_date : (parsed?.due_date ?? defaultDueDate ?? null)
  const effDueTime = manualDate ? manualDate.due_time : (parsed?.due_time ?? null)
  const effRepeat = manualDate ? manualDate.repeat : (parsed?.repeat ?? null)
  const effPriority = manualPriority ?? parsed?.priority ?? 4
  // For display/count: explicit ids, else NLP names
  const effLabelCount = manualLabelIds ? manualLabelIds.length : (parsed?.label_ids.length ?? 0)

  const reset = () => {
    setText(''); setExpanded(false); setShowConfirm(false)
    setManualDate(null); setManualPriority(null); setManualLabelIds(null); setOpenMenu(null)
  }

  const submit = async () => {
    const title = (parsed?.title ?? text).trim()
    if (!title) return
    setLoading(true)
    try {
      // Resolve label ids: explicit picks win; otherwise resolve NLP #names to ids
      let labelIds: string[]
      if (manualLabelIds !== null) {
        labelIds = manualLabelIds
      } else {
        const allLabels = await api.getLabels()
        labelIds = []
        for (const name of (parsed?.label_ids || [])) {
          let lbl = allLabels.find(l => l.name === name)
          if (!lbl) {
            const colors = ['#c25e4c', '#c98a2e', '#5b7fa6', '#7a9461', '#8a6fa8']
            lbl = await api.addLabel(name, colors[Math.floor(Math.random() * colors.length)])
          }
          labelIds.push(lbl.id)
        }
      }

      const body: Record<string, any> = {
        title,
        project_id: parsed?.project_id || projectId || 'inbox',
        priority: effPriority,
        labels: labelIds,
      }
      if (sectionId) body.section_id = sectionId
      if (effDueDate) body.due_date = effDueDate
      else if (defaultDueDate) body.due_date = defaultDueDate
      if (effDueTime) body.due_time = effDueTime
      if (effRepeat) body.repeat = effRepeat

      const task = await api.addTask(body as any)
      reset()
      if (onDone) onDone(task)
    } catch (err) {
      console.error('Failed to add task:', err)
    } finally {
      setLoading(false)
    }
  }

  const findLabel = (id: string) => labels.find((l) => l.id === id)

  const handleCancel = () => {
    if (text.trim() || manualDate || manualPriority !== null || manualLabelIds !== null) setShowConfirm(true)
    else reset()
  }

  if (!expanded && collapsed) {
    return (
      <button className="btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--text-secondary)', fontSize: 13, width: '100%', marginBottom: 12 }}
        onClick={() => setExpanded(true)}>
        <Icon name="plus" size={14} style={{ color: 'var(--accent)' }} /> {collapsedLabel || '添加任务'}
      </button>
    )
  }

  const pickerActive = (on: boolean) => ({
    fontSize: 12, padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)',
    background: on ? 'var(--accent-soft)' : 'transparent', color: on ? 'var(--accent-text)' : 'var(--text-secondary)',
    cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const,
  })

  return (
    <div className="composer" style={{ margin: '0 0 16px' }}>
      {showConfirm && (
        <div className="modal-scrim" style={{ zIndex: 1000 }} onClick={e => { if (e.target === e.currentTarget) setShowConfirm(false) }}>
          <div className="modal-card" style={{ maxWidth: 320, marginTop: '20vh', padding: 20 }}>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 8 }}>放弃未保存的修改？</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>您输入的内容将不会被保存。</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" onClick={() => setShowConfirm(false)}>取消</button>
              <button className="btn-primary" style={{ background: 'var(--p1)' }} onClick={reset}>放弃</button>
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
            if (e.key === 'Enter' && !loading) { e.preventDefault(); submit() }
            if (e.key === 'Escape') handleCancel()
          }}
          placeholder={placeholder || '添加任务… 试试「明天下午3点 #论文写作 p2」'}
          style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 14, color: 'var(--text-primary)', minWidth: 0 }}
        />
        {(text || manualDate || manualPriority !== null) && (
          <button className="btn-primary" style={{ padding: '4px 12px', fontSize: 12.5 }} onClick={submit} disabled={loading}>添加</button>
        )}
      </div>

      {/* Explicit picker bar — click to set, overrides NLP for that field */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 12px 8px' }}>
        <button ref={dateRef} style={pickerActive(!!effDueDate)} onClick={() => setOpenMenu(m => m === 'date' ? null : 'date')}>
          <Icon name="calendar" size={13} />
          {effDueDate ? DateU.human(effDueDate) + (effDueTime ? ' ' + effDueTime : '') + (effRepeat ? ' · ' + (REPEAT_LABELS[effRepeat] || effRepeat) : '') : '日期'}
        </button>
        <button ref={prioRef} style={pickerActive(effPriority < 4)} onClick={() => setOpenMenu(m => m === 'priority' ? null : 'priority')}>
          <Icon name="flag" size={13} style={{ color: effPriority < 4 ? PRIORITY_META[effPriority].color : undefined }} />
          {effPriority < 4 ? 'P' + effPriority : '优先级'}
        </button>
        <button ref={labelRef} style={pickerActive(effLabelCount > 0)} onClick={() => setOpenMenu(m => m === 'label' ? null : 'label')}>
          <Icon name="hash" size={13} />
          {effLabelCount > 0
            ? (manualLabelIds ? manualLabelIds.map(id => findLabel(id)?.name).filter(Boolean).join('、') || `${effLabelCount} 个标签` : (parsed?.label_ids || []).join('、'))
            : '标签'}
        </button>
      </div>

      {openMenu === 'date' && (
        <DateMenu anchorRef={dateRef} value={effDueDate} time={effDueTime} repeat={effRepeat}
          onPick={(r) => { setManualDate(r); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />
      )}
      {openMenu === 'priority' && (
        <PriorityMenu anchorRef={prioRef} onPick={(p) => { setManualPriority(p); setOpenMenu(null) }} onClose={() => setOpenMenu(null)} />
      )}
      {openMenu === 'label' && (
        <LabelMenu anchorRef={labelRef} selected={manualLabelIds ?? []}
          onToggle={(id) => setManualLabelIds(prev => { const cur = prev ?? []; return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id] })}
          onClose={() => setOpenMenu(null)} />
      )}

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
