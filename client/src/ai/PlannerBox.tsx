import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { PlanProposal, PlanQuestion, PlanResult, Project } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { byokBody, byokError, getByokConfig } from '../utils/byok'
import { getProvider } from '../providers'
import { SettingsModal } from '../components/SettingsModal'

/* ============================================================
   PlannerBox —— 一次性 AI 规划输入框（聊天面板「坍缩」后的网页出口）。

   不是聊天：把想法一次性倒进大输入框 → 生成计划 → 逐条/全部采纳（走既有 REST）。
   信息不足时模型返回澄清问题（QuestionCard），答案组合成 answers 再发一轮。
   状态全部在内存里，关掉即丢，不做会话持久化。BYOK 配置沿用 localStorage
   （SettingsModal），与 MCP 出口共用同一个 POST /api/plan。
   ============================================================ */

type ApplyState = { status: 'applying' | 'ok' | 'fail'; msg?: string }

/* ============ ProposalCard（沿用旧聊天面板的渲染，扩展逐条采纳） ============ */
function ProposalCard({ proposals, applied, onApplyOne, onApplyAll }: {
  proposals: PlanProposal[]
  applied: Record<number, ApplyState>
  onApplyOne: (i: number) => void
  onApplyAll: () => void
}) {
  const opLabel: Record<string, string> = { create: '新建', update: '修改', complete: '完成', delete: '删除' }
  const pending = proposals.filter((_, i) => !applied[i])
  return (
    <div className="proposal-card">
      <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ai)' }}>AI 计划 · {proposals.length} 条</span>
      </div>
      {proposals.map((p, i) => {
        const st = applied[i]
        return (
          <div key={i} className="proposal-row">
            <span className={'proposal-op ' + (p.op || 'create')}>{opLabel[p.op] || '操作'}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.title || (p.task_id ? `任务 ${String(p.task_id).slice(-6)}` : '')}</div>
              {p.due_date && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{DateU.human(p.due_date)}{p.due_time ? ' ' + p.due_time : ''}{p.priority && p.priority < 4 ? ` · P${p.priority}` : ''}</div>}
              {p.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{p.description}</div>}
              {st?.status === 'fail' && <div style={{ fontSize: 11.5, color: 'var(--p1, #c25e4c)', marginTop: 2 }}>失败：{st.msg}</div>}
            </div>
            {!st && (
              <button className="btn-outline" style={{ fontSize: 12, padding: '3px 10px', flex: 'none' }} onClick={() => onApplyOne(i)}>采纳</button>
            )}
            {st?.status === 'applying' && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flex: 'none' }}>…</span>}
            {st?.status === 'ok' && <span style={{ fontSize: 12, color: 'var(--green)', flex: 'none' }}><Icon name="check" size={12} /> 已采纳</span>}
            {st?.status === 'fail' && <span style={{ fontSize: 12, color: 'var(--p1, #c25e4c)', flex: 'none' }}>✗</span>}
          </div>
        )
      })}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px 10px' }}>
        <button className="btn-primary" style={{ fontSize: 12.5, flex: 1, opacity: pending.length ? 1 : .5 }} disabled={!pending.length} onClick={onApplyAll}>
          <Icon name="check" size={13} /> 全部采纳{pending.length && pending.length < proposals.length ? `（剩 ${pending.length} 条）` : ''}
        </button>
      </div>
    </div>
  )
}

/* ============ QuestionCard（智能反问；沿用旧渲染，答案组合成 answers 数组） ============ */
function QuestionCard({ questions, onSubmit }: { questions: PlanQuestion[]; onSubmit: (answers: string[]) => void }) {
  const OTHER = '__other__'
  const [selected, setSelected] = useState<Record<number, string>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})

  const answerOf = (i: number) => selected[i] === OTHER ? (otherText[i] || '').trim() : (selected[i] || '')
  const allAnswered = questions.every((_, i) => answerOf(i).length > 0)

  const submit = () => {
    if (!allAnswered) return
    onSubmit(questions.map((q, i) => `${q.q} ${answerOf(i)}`))
  }

  const renderChip = (qi: number, label: string, value: string) => {
    const active = selected[qi] === value
    return (
      <button key={value} onClick={() => setSelected(s => ({ ...s, [qi]: value }))}
        style={{ fontSize: 12.5, padding: '4px 11px', borderRadius: 14, cursor: 'pointer', border: '1px solid ' + (active ? 'var(--ai)' : 'var(--border)'), background: active ? 'var(--ai)' : 'var(--bg-content)', color: active ? '#fff' : 'var(--text-secondary)' }}>{label}</button>
    )
  }

  return (
    <div className="proposal-card">
      <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ai)' }}>请补充几个细节</span>
      </div>
      {questions.map((q, i) => (
        <div key={i} style={{ padding: '4px 12px 8px' }}>
          <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 6 }}>{q.q}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(q.options || []).map(opt => renderChip(i, opt, opt))}
            {renderChip(i, '其他', OTHER)}
          </div>
          {selected[i] === OTHER && (
            <input autoFocus value={otherText[i] || ''} onChange={e => setOtherText(t => ({ ...t, [i]: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); submit() } }}
              placeholder="输入你的答案"
              style={{ marginTop: 6, width: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 13, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none' }} />
          )}
        </div>
      ))}
      <div style={{ padding: '4px 12px 10px' }}>
        <button className="btn-primary" style={{ fontSize: 12.5, width: '100%', opacity: allAnswered ? 1 : .5 }} disabled={!allAnswered} onClick={submit}>
          <Icon name="send" size={13} /> 提交回答并重新规划
        </button>
      </div>
    </div>
  )
}

/* ============ PlannerBox 主体 ============ */

interface PlannerBoxProps {
  /** 打开时默认选中的项目（决定规划上下文与新任务归属）。 */
  defaultProjectId?: string
  onClose: () => void
  /** 任一条 proposal 落库成功后回调（App 用来立刻刷新任务列表）。 */
  onApplied?: () => void
}

export function PlannerBox({ defaultProjectId, onClose, onApplied }: PlannerBoxProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState(defaultProjectId || 'inbox')
  const [brainDump, setBrainDump] = useState('')
  const [answers, setAnswers] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PlanResult | null>(null)
  const [transportError, setTransportError] = useState<string | null>(null)
  const [applied, setApplied] = useState<Record<number, ApplyState>>({})
  // 与 applied 同步的 ref：applyAll 循环里跨 await 读取时不吃 React 状态快照的旧值，
  // 避免「全部采纳」进行中用户又点了单条「采纳」导致的重复落库。
  const appliedRef = useRef<Record<number, ApplyState>>({})
  const [showSettings, setShowSettings] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const markApplied = (i: number, st: ApplyState) => {
    appliedRef.current = { ...appliedRef.current, [i]: st }
    setApplied(appliedRef.current)
  }

  useEffect(() => {
    api.getProjects().then(ps => setProjects(ps.filter(p => !p.archived))).catch(() => {})
    textareaRef.current?.focus()
  }, [])

  // Esc 关闭（设置弹窗打开时先让它自己处理）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showSettings) { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [showSettings, onClose])

  const generate = async (nextAnswers?: string[]) => {
    const dump = brainDump.trim()
    if (!dump || loading) return
    const byokErr = byokError()
    if (byokErr) { setTransportError(byokErr); return }

    const mergedAnswers = nextAnswers ? [...answers, ...nextAnswers] : []
    setAnswers(mergedAnswers)
    setLoading(true)
    setTransportError(null)
    setResult(null)
    appliedRef.current = {}
    setApplied({})
    try {
      const r = await api.plan({
        brain_dump: dump,
        answers: mergedAnswers.length ? mergedAnswers : undefined,
        project_id: projectId || undefined,
        ...byokBody(),
      })
      setResult(r)
    } catch (err: any) {
      setTransportError(err?.message || '请求失败')
    }
    setLoading(false)
  }

  /* 逐条采纳：走既有 REST（与旧聊天面板的应用逻辑一致，但不再写消息表）。 */
  const applyOne = async (proposals: PlanProposal[], i: number) => {
    const p = proposals[i]
    if (!p || appliedRef.current[i]) return
    markApplied(i, { status: 'applying' })
    try {
      if (p.op === 'create') {
        await api.addTask({
          title: p.title || '', project_id: projectId || 'inbox',
          due_date: p.due_date || null, due_time: p.due_time || null,
          priority: p.priority ?? 4, description: p.description || '', labels: '[]',
        })
      } else if (p.op === 'update' && p.task_id) {
        const { op: _op, task_id, ...patch } = p
        await api.updateTask(task_id, patch as any)
      } else if (p.op === 'complete' && p.task_id) {
        const t = await api.getTask(p.task_id)
        if (t && !t.completed) await api.toggleTask(p.task_id)
      } else if (p.op === 'delete' && p.task_id) {
        await api.deleteTask(p.task_id)
      } else {
        throw new Error('无效操作')
      }
      markApplied(i, { status: 'ok' })
      onApplied?.()
    } catch (err: any) {
      markApplied(i, { status: 'fail', msg: err?.message || '未知错误' })
    }
  }

  const applyAll = async (proposals: PlanProposal[]) => {
    for (let i = 0; i < proposals.length; i++) {
      if (!appliedRef.current[i]) await applyOne(proposals, i)
    }
  }

  const byok = getByokConfig()
  const providerLabel = `${getProvider(byok.providerId).label}${byok.model ? ' · ' + byok.model : ''}`
  const metaLine = (m: { model: string; latencyMs: number; repaired: boolean }) =>
    `${m.model} · ${(m.latencyMs / 1000).toFixed(1)}s${m.repaired ? ' · 经修复重试' : ''}`

  return (
    <div className="modal-scrim" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-card" style={{ maxWidth: 600, width: 'calc(100vw - 48px)', marginTop: '9vh', padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '78vh' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 10px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
          <Icon name="sparkle" size={16} style={{ color: 'var(--ai)' }} />
          <span style={{ fontSize: 14.5, fontWeight: 700, flex: 1 }}>AI 规划</span>
          <button className="btn-ghost" style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }} title="AI 设置（服务商 / 模型 / 自带 Key）" onClick={() => setShowSettings(true)}>
            <Icon name="brain" size={13} /> {providerLabel}
          </button>
          <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ padding: '14px 16px 16px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 输入区 */}
          <textarea
            ref={textareaRef}
            value={brainDump}
            onChange={e => setBrainDump(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate() }
            }}
            placeholder={'把想法一次性倒进来：目标、约束、时间点……\n例：下周三前交开题报告初稿，这周还想恢复健身，另外妈妈生日是周六。\n\nAI 会基于你现有的任务和项目，生成一份可逐条采纳的计划。'}
            rows={5}
            disabled={loading}
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, lineHeight: 1.6, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', resize: 'vertical', fontFamily: 'var(--font)', minHeight: 110 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <select value={projectId} onChange={e => setProjectId(e.target.value)} disabled={loading}
              title="规划上下文 + 新任务归属的项目"
              style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', fontSize: 12.5, background: 'var(--bg-content)', color: 'var(--text-secondary)', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font)', maxWidth: 180 }}>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <span style={{ flex: 1 }} />
            <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>⌘⏎</kbd>
            <button className="btn-primary" style={{ fontSize: 13 }} disabled={!brainDump.trim() || loading} onClick={() => generate()}>
              {loading ? '规划中…' : <><Icon name="sparkle" size={13} /> 生成计划</>}
            </button>
          </div>

          {/* Loading */}
          {loading && (
            <div style={{ display: 'flex', gap: 5, padding: '10px 12px', background: 'var(--bg-card)', borderRadius: 10, width: 'fit-content', border: '1px solid var(--border-soft)' }}>
              {[0, 1, 2].map(i => <span key={i} className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ai)', display: 'block' }} />)}
            </div>
          )}

          {/* 错误（BYOK 未配 / 网络 / 模型侧） */}
          {(transportError || result?.type === 'error') && !loading && (
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text-primary)', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>规划失败</div>
              {transportError || (result?.type === 'error' ? result.error : '')}
              {result?.type === 'error' && <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 6 }}>{metaLine(result.meta)}</div>}
            </div>
          )}

          {/* 澄清问题 */}
          {result?.type === 'questions' && !loading && (
            <QuestionCard questions={result.questions} onSubmit={ans => generate(ans)} />
          )}

          {/* 计划 */}
          {result?.type === 'proposals' && !loading && (
            <>
              <ProposalCard
                proposals={result.proposals}
                applied={applied}
                onApplyOne={i => applyOne(result.proposals, i)}
                onApplyAll={() => applyAll(result.proposals)}
              />
              <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'right' }}>{metaLine(result.meta)}</div>
            </>
          )}
        </div>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
