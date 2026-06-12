import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task, Project, Memory, Message } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'

/* ============ Markdown 超轻渲染 ============ */
function MiniMd({ text }: { text: string }) {
  if (!text) return null
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^[•\-*] (.+)$/gm, '• $1<br/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')
  return <div className="ai-msg-md" dangerouslySetInnerHTML={{ __html: '<p>' + html + '</p>' }} />
}

/* ============ ProposalCard ============ */
function ProposalCard({ proposals, onApply, onReject }: { proposals: any[]; onApply: (ps: any[]) => void; onReject: () => void }) {
  const opLabel: Record<string, string> = { create: '新建', update: '修改', complete: '完成', delete: '删除' }
  return (
    <div className="proposal-card">
      <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} />
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ai)' }}>AI 建议操作 · {proposals.length} 条</span>
      </div>
      {proposals.map((p, i) => (
        <div key={i} className="proposal-row">
          <span className={'proposal-op ' + (p.op || 'create')}>{opLabel[p.op] || '操作'}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500 }}>{p.title || p.summary}</div>
            {p.due_date && <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{DateU.human(p.due_date)}{p.due_time ? ' ' + p.due_time : ''}</div>}
            {p.description && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{p.description}</div>}
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px 10px' }}>
        <button className="btn-primary" style={{ fontSize: 12.5, flex: 1 }} onClick={() => onApply(proposals)}>
          <Icon name="check" size={13} /> 应用全部
        </button>
        <button className="btn-outline" style={{ fontSize: 12.5, flex: 1 }} onClick={onReject}>忽略</button>
      </div>
    </div>
  )
}

/* ============ MentionMenu ============ */
function MentionMenu({ items, onSelect, selectedIndex }: { items: any[]; onSelect: (item: any) => void; selectedIndex: number }) {
  if (!items.length) return null
  return (
    <div className="popover" style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 6, width: 280, maxHeight: 240, overflowY: 'auto', padding: 4, zIndex: 1100 }}>
      {items.map((item, i) => (
        <button key={item.id || i} className={'menu-item' + (i === selectedIndex ? ' is-active' : '')}
          onMouseDown={(e) => { e.preventDefault(); onSelect(item) }}>
          {item.type === 'task' && <><Icon name="check" size={14} /><span style={{ flex: 1 }}>{item.title}</span>{item.due_date && <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{DateU.human(item.due_date)}</span>}</>}
          {item.type === 'project' && <><Icon name="hash" size={14} style={{ color: item.color }} />{item.name}</>}
          {item.type === 'date' && <><Icon name="calendar" size={14} />{item.name} <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>{item.date}</span></>}
        </button>
      ))}
    </div>
  )
}

const SLASH_CMDS = [
  { cmd: '/compact', desc: '压缩对话上下文', icon: 'compress' },
  { cmd: '/summarize', desc: '总结当前项目进展', icon: 'doc' },
  { cmd: '/decompose', desc: '分解任务为子任务', icon: 'subtask' },
  { cmd: '/schedule', desc: '安排本周计划', icon: 'calendar' },
]

interface AIPanelProps {
  projectId: string
  refTask: Task | null
  layout: 'float' | 'sidebar' | 'bottom'
  onClose: () => void
}

export function AIPanel({ projectId: initProjectId, refTask, layout, onClose }: AIPanelProps) {
  const [projectId, setProjectId] = useState(initProjectId || 'inbox')
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [thinking, setThinking] = useState(false)
  const [activeTab, setActiveTab] = useState<'chat' | 'memory' | 'agents'>('chat')
  const [agentsContent, setAgentsContent] = useState('')
  const [agentsDirty, setAgentsDirty] = useState(false)
  const [val, setVal] = useState('')
  const [memories, setMemories] = useState<Memory[]>([])
  const [mention, setMention] = useState<{ type: string; query: string; pos: number } | null>(null)
  const [refs, setRefs] = useState<{ type: string; id: string; name: string; date?: string }[]>([])
  const [mentionItems, setMentionItems] = useState<any[]>([])
  const [showSlash, setShowSlash] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [allTasks, setAllTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])

  // Load data
  useEffect(() => {
    api.getProjects().then(setProjects)
    api.getTasks().then(setAllTasks)
  }, [])

  useEffect(() => {
    (async () => {
      let convs = await api.getConversations(projectId)
      if (!convs.length) {
        const c = await api.addConversation(projectId, 'Default')
        convs = [c]
      }
      const c = convs[0]
      setConvId(c.id)
      const msgs = await api.getMessages(c.id)
      setMessages(msgs)
      const doc = await api.getAgentsDoc(projectId)
      setAgentsContent(doc.content)
      setAgentsDirty(false)
      const mems = await api.getMemories(projectId)
      setMemories(mems)
    })()
  }, [projectId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, thinking])

  useEffect(() => {
    if (refTask) setRefs([{ type: 'task', id: refTask.id, name: refTask.title }])
  }, [refTask?.id])

  /* ============ @mention detection ============ */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setVal(v)

    if (v === '/' || (v.startsWith('/') && !v.includes(' '))) {
      setShowSlash(true)
      setMention(null)
    } else {
      setShowSlash(false)
    }

    const pos = e.target.selectionStart
    const before = v.slice(0, pos)
    const atMatch = before.match(/@([^\s@]*)$/)
    if (atMatch) {
      const query = atMatch[1].toLowerCase()
      const atPos = pos - atMatch[0].length
      const tasks = allTasks.filter(t => !t.completed && !t.parent_id && t.title.toLowerCase().includes(query)).slice(0, 6)
        .map(t => ({ type: 'task', id: t.id, title: t.title, due_date: t.due_date }))
      const projs = projects.filter(p => p.name.toLowerCase().includes(query)).slice(0, 3)
        .map(p => ({ type: 'project', id: p.id, name: p.name, color: p.color }))
      const dates = [
        { type: 'date', id: 'today', name: '今天', date: DateU.today() },
        { type: 'date', id: 'tomorrow', name: '明天', date: DateU.addDays(DateU.today(), 1) },
        { type: 'date', id: 'next_week', name: '下周', date: DateU.addDays(DateU.today(), 7) },
      ].filter(d => d.name.includes(query || ''))
      setMention({ type: 'task', query, pos: atPos })
      setMentionItems([...tasks, ...projs, ...dates])
      setSelectedIndex(0)
    } else {
      setMention(null)
      setMentionItems([])
    }
  }

  const insertMention = (item: any) => {
    if (!mention) return
    const before = val.slice(0, mention.pos)
    const after = val.slice(textareaRef.current?.selectionStart || 0)
    const pillText = item.date ? item.name : (item.title || item.name)
    const newVal = before + '@' + pillText + ' ' + after
    setVal(newVal)
    setRefs(r => [...r, { type: item.type, id: item.id, name: pillText, date: item.date || undefined }])
    setMention(null)
    setMentionItems([])
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const execSlash = (cmd: string) => {
    setVal(cmd + ' ')
    setShowSlash(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  /* ============ send / compact ============ */
  const send = async () => {
    const text = val.trim()
    if (!text || !convId || thinking) return
    setVal('')
    setShowSlash(false)

    // Build ref context for AI
    let refContext = ''
    if (refs.length > 0) {
      refContext = '\n\n引用：' + refs.map(r => {
        if (r.type === 'task') {
          const t = allTasks.find(x => x.id === r.id)
          if (t) return `任务「${t.title}」(${t.id.slice(-6)}) - 优先级P${t.priority}${t.due_date ? ' 截止'+t.due_date : ''}${t.description ? ' 描述:'+t.description : ''}`
          return `任务「${r.name}」(${r.id.slice(-6)})`
        }
        if (r.type === 'project') {
          const p = projects.find(x => x.id === r.id)
          if (p) return `项目「${p.name}」`
          return r.name
        }
        if (r.type === 'date') return `日期 ${r.date}`
        return r.name
      }).join(', ')
    }
    setRefs([])

    // /compact: summarize recent messages into memory
    if (text.startsWith('/compact')) {
      const msgs = await api.getMessages(convId!)
      if (msgs.length < 4) return
      // Build summary from recent messages
      const recentMsgs = msgs.slice(-8)
      const summaryParts = recentMsgs
        .filter(m => m.role !== 'system')
        .map(m => `[${m.role === 'user' ? '用户' : 'AI'}]: ${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''}`)
      const summary = `对话压缩摘要 (${new Date().toLocaleDateString('zh-CN')} ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})\n原始消息数: ${msgs.length}\n\n${summaryParts.join('\n')}`
      await api.clearMessages(convId!)
      await api.addMessage(convId!, 'system', `对话已压缩 (${msgs.length} 条 → 长期记忆)`)
      await api.addMemory(projectId, summary, 'compact')
      setMessages(await api.getMessages(convId!))
      return
    }

    await api.addMessage(convId!, 'user', text + refContext)
    setThinking(true)

    const streamingId = '_streaming_'
    setMessages(prev => [...prev, { id: streamingId, role: 'assistant', content: '', conversation_id: convId!, refs: '[]', proposals: null, proposals_applied: 0, created_at: '' }])

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text + refContext, project_id: projectId, conv_id: convId }),
      })

      if (!response.ok) {
        const errBody = await response.text()
        let errMsg = 'AI 服务错误'
        try { errMsg = JSON.parse(errBody).error || errMsg } catch {}
        setMessages(prev => prev.filter(m => m.id !== streamingId))
        setMessages(prev => [...prev, { id: streamingId + '_err', role: 'assistant', content: `错误: ${errMsg}`, conversation_id: convId!, refs: '[]', proposals: null, proposals_applied: 0, created_at: '' }])
        setThinking(false)
        return
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let fullContent = ''
      let fullReasoning = ''
      let proposals: any = null
      let currentEvent = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop()!

          for (const line of lines) {
            if (line.startsWith('event: ')) {
              currentEvent = line.slice(7).trim()
              continue
            }
            if (!line.startsWith('data: ')) continue
            try {
              const obj = JSON.parse(line.slice(6))
              if (currentEvent === 'reasoning') {
                fullReasoning += obj.reasoning_content || ''
              } else if (currentEvent === 'delta') {
                fullContent += obj.content || ''
                setMessages(prev => prev.map(m => m.id === streamingId ? { ...m, content: fullContent } : m))
              } else if (currentEvent === 'error') {
                setMessages(prev => prev.filter(m => m.id !== streamingId))
                setMessages(prev => [...prev, { id: streamingId + '_err', role: 'assistant', content: `AI 错误: ${obj.error || '未知错误'}`, conversation_id: convId!, refs: '[]', proposals: null, proposals_applied: 0, created_at: '' }])
                setThinking(false)
                return
              } else if (currentEvent === 'done') {
                fullContent = obj.content || fullContent
                proposals = obj.proposals
                fullReasoning = obj.reasoning_content || fullReasoning
              }
              // reset event after processing data
              if (currentEvent === 'done' || currentEvent === 'error') currentEvent = ''
            } catch {}
          }
        }
      }

      setMessages(prev => prev.filter(m => m.id !== streamingId))

      // Don't save empty assistant messages
      if (!fullContent.trim() && !proposals) {
        setThinking(false)
        return
      }

      const saved = await api.addMessage(convId!, 'assistant', fullContent.trim() || '(empty)', { proposals })

      const allMsgs = await api.getMessages(convId!)
      if (allMsgs.length % 5 === 0 && allMsgs.length > 0) {
        api.addMemory(projectId, `Chat summary (${allMsgs.length}): ${fullContent.slice(0, 120)}`, 'ai')
      }

      setMessages(prev => [...prev.filter(m => m.id !== streamingId), saved])
    } catch (err: any) {
      setMessages(prev => prev.filter(m => m.id !== streamingId))
      await api.addMessage(convId!, 'assistant', 'Error: ' + err.message)
      setMessages(await api.getMessages(convId!))
    }
    setThinking(false)
  }

  const applyProposals = async (proposals: any[], msgId: string) => {
    let successCount = 0
    const errors: string[] = []
    for (const p of proposals) {
      try {
        if (p.op === 'create') {
          await api.addTask({ title: p.title, project_id: projectId, due_date: p.due_date || null, due_time: p.due_time || null, priority: p.priority || 4, description: p.description || '', labels: [] } as any)
        } else if (p.op === 'update' && p.task_id) {
          await api.updateTask(p.task_id, p)
        } else if (p.op === 'complete' && p.task_id) {
          await api.toggleTask(p.task_id)
        } else if (p.op === 'delete' && p.task_id) {
          await api.deleteTask(p.task_id)
        }
        successCount++
      } catch (err: any) {
        errors.push(`${p.op || '操作'} "${p.title || p.task_id}": ${err.message}`)
      }
    }
    await api.updateMessage(msgId, { proposals_applied: 1 })
    // Show feedback message
    const feedback = successCount > 0
      ? `✓ 已应用 ${successCount} 条操作` + (errors.length > 0 ? `，${errors.length} 条失败` : '')
      : `✗ 操作失败：${errors.join('; ')}`
    await api.addMessage(convId!, 'system', feedback)
    setMessages(prev => [...prev, { id: '_fb_' + Date.now(), role: 'system', content: feedback, conversation_id: convId!, refs: '[]', proposals: null, proposals_applied: 0, created_at: '' }])
  }

  /* ============ panel content ============ */
  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <Icon name="sparkle" size={16} style={{ color: 'var(--ai)' }} />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          style={{ flex: 1, border: 'none', background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 2 }}>
          {([['chat', '对话'], ['memory', '记忆'], ['agents', 'AGENTS']] as const).map(([t, l]) => (
            <button key={t} className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px', background: activeTab === t ? 'var(--ai-soft)' : 'none', color: activeTab === t ? 'var(--ai)' : 'var(--text-secondary)' }}
              onClick={() => setActiveTab(t)}>{l}</button>
          ))}
        </div>
        <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      {/* Chat tab */}
      {activeTab === 'chat' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-tertiary)' }}>
                <Icon name="sparkle" size={32} strokeWidth={1.2} style={{ marginBottom: 8, opacity: .5 }} />
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 4 }}>和 AI 聊聊项目</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>输入 <code style={{ background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4 }}>@</code> 引用任务，<code style={{ background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4 }}>/</code> 查看指令</div>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
                {msg.role === 'system' && (
                  <div style={{ alignSelf: 'center', fontSize: 11.5, color: 'var(--text-tertiary)', padding: '3px 10px', background: 'var(--bg-inset)', borderRadius: 8 }}>{msg.content}</div>
                )}
                {msg.role !== 'system' && (
                  <div style={{ maxWidth: '88%', padding: '8px 12px', borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px', background: msg.role === 'user' ? 'var(--ai)' : 'var(--bg-card)', color: msg.role === 'user' ? '#fff' : 'var(--text-primary)', fontSize: 13.5, lineHeight: 1.55, border: msg.role === 'assistant' ? '1px solid var(--border-soft)' : 'none' }}>
                    {msg.role === 'assistant' ? <MiniMd text={msg.content} /> : msg.content}
                  </div>
                )}
                {msg.proposals && !msg.proposals_applied && (() => {
                  try { return <ProposalCard proposals={JSON.parse(msg.proposals)} onApply={(ps) => applyProposals(ps, msg.id)} onReject={() => { api.updateMessage(msg.id, { proposals_applied: 1 }); setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, proposals_applied: 1 } : m)) }} /> }
                  catch { return null }
                })()}
                {msg.proposals_applied ? <span style={{ fontSize: 11.5, color: 'var(--green)' }}><Icon name="check" size={12} /> 已应用</span> : null}
              </div>
            ))}
            {thinking && (
              <div style={{ display: 'flex', gap: 5, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '4px 14px 14px 14px', width: 'fit-content', border: '1px solid var(--border-soft)' }}>
                {[0, 1, 2].map((i) => <span key={i} className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ai)', display: 'block' }} />)}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
            {/* Mention pills */}
            {refs.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                {refs.map((r, i) => (
                  <span key={i} className="mention-pill">
                    {r.type === 'task' ? <Icon name="check" size={11} /> : r.type === 'project' ? <Icon name="hash" size={11} /> : <Icon name="calendar" size={11} />}
                    {r.name}
                    <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--ai)', fontSize: 11, lineHeight: 1 }}
                      onClick={() => setRefs(arr => arr.filter((_, j) => j !== i))}>×</button>
                  </span>
                ))}
              </div>
            )}
            {/* Mention dropdown */}
            {mention && mentionItems.length > 0 && <MentionMenu items={mentionItems} onSelect={insertMention} selectedIndex={selectedIndex} />}
            {/* Slash commands */}
            {showSlash && (
              <div className="popover" style={{ position: 'absolute', bottom: '100%', left: 14, right: 14, marginBottom: 6, padding: 4 }}>
                {SLASH_CMDS.filter(c => c.cmd.includes(val.split(' ')[0])).map((c) => (
                  <button key={c.cmd} className="menu-item" onClick={() => execSlash(c.cmd)}>
                    <Icon name={c.icon} size={14} /><strong style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{c.cmd}</strong>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>{c.desc}</span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: '8px 12px' }}>
                <textarea ref={textareaRef} value={val} onChange={handleInput}
                  onKeyDown={(e) => {
                    if (mention && mentionItems.length > 0) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, mentionItems.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
                      else if (e.key === 'Enter') { e.preventDefault(); insertMention(mentionItems[selectedIndex]) }
                      else if (e.key === 'Escape') { e.preventDefault(); setMention(null); setMentionItems([]) }
                      return
                    }
                    if (showSlash) {
                      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, SLASH_CMDS.length - 1)) }
                      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)) }
                      else if (e.key === 'Enter') { e.preventDefault(); const cmds = SLASH_CMDS.filter(c => c.cmd.includes(val.split(' ')[0])); if (cmds[selectedIndex]) execSlash(cmds[selectedIndex].cmd) }
                      else if (e.key === 'Escape') { e.preventDefault(); setShowSlash(false) }
                      return
                    }
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  placeholder="发消息… @ 引用任务，/ 查看命令"
                  rows={1} disabled={thinking}
                  style={{ border: 'none', outline: 'none', resize: 'none', background: 'none', fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5, width: '100%', fontFamily: 'var(--font)' }} />
              </div>
              <button className="btn-icon" style={{ background: val.trim() ? 'var(--ai)' : 'var(--bg-inset)', color: val.trim() ? '#fff' : 'var(--text-tertiary)', borderRadius: 10, width: 36, height: 36, flex: 'none' }}
                onClick={send} disabled={!val.trim() || thinking}>
                <Icon name="send" size={16} />
              </button>
            </div>
          </div>
        </>
      )}

      {/* Memory tab */}
      {activeTab === 'memory' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>项目记忆 · {memories.length} 条</div>
          {memories.map((m) => (
            <div key={m.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 9, padding: '8px 11px', marginBottom: 7, fontSize: 13 }}>
              <div style={{ color: 'var(--text-primary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{m.content}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{new Date(m.created_at).toLocaleDateString('zh-CN')}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 6px' }}>{m.source}</span>
                <button className="btn-icon" style={{ width: 20, height: 20, marginLeft: 'auto' }} onClick={() => { api.deleteMemory(m.id); setMemories(prev => prev.filter(x => x.id !== m.id)) }}>
                  <Icon name="trash" size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agents tab */}
      {activeTab === 'agents' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>AGENTS.md</div>
          <textarea value={agentsContent}
            onChange={(e) => { setAgentsContent(e.target.value); setAgentsDirty(true) }}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', fontSize: 13, lineHeight: 1.65, fontFamily: 'var(--mono)', background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', resize: 'none' }}
            placeholder="# AGENTS.md" />
          {agentsDirty && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 13 }} onClick={() => { api.setAgentsDoc(projectId, agentsContent); setAgentsDirty(false) }}>保存</button>
              <button className="btn-outline" style={{ flex: 1, fontSize: 13 }} onClick={async () => { const doc = await api.getAgentsDoc(projectId); setAgentsContent(doc.content); setAgentsDirty(false) }}>取消</button>
            </div>
          )}
        </div>
      )}
    </div>
  )

  if (layout === 'sidebar') {
    return <div style={{ width: 360, height: '100%', borderLeft: '1px solid var(--border-soft)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>{panelContent}</div>
  }
  if (layout === 'bottom') {
    return <div style={{ position: 'fixed', bottom: 0, right: 0, left: 220, zIndex: 800, height: 400, background: 'var(--bg-card)', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)', boxShadow: '0 -6px 24px rgba(0,0,0,.12)', animation: 'pop-in .16s ease-out' }}>{panelContent}</div>
  }
  return <div style={{ position: 'fixed', right: 20, bottom: 86, width: 380, height: 520, zIndex: 900, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-soft)', boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'pop-in .16s ease-out' }}>{panelContent}</div>
}
