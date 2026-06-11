/* ai-panel.jsx — AI 对话面板（3种布局 via Tweaks）
   功能：@任务/项目/分区/日期 引用，/命令，提案卡确认，Memory + AGENTS.md 管理 */
const { useState, useEffect, useRef, useCallback, useMemo } = React;

/* ============ Markdown 超轻渲染 ============ */
function MiniMd({ text }) {
  if (!text) return null;
  const html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^#{1,3} (.+)$/gm, '<strong>$1</strong>')
    .replace(/^[•\-\*] (.+)$/gm, '• $1<br/>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  return <div className="ai-msg-md" dangerouslySetInnerHTML={{ __html: '<p>' + html + '</p>' }} />;
}

/* ============ 提案卡 ============ */
function ProposalCard({ proposals, onApply, onReject }) {
  const opLabel = { create: '新建', update: '修改', complete: '完成', delete: '删除' };
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
        <button className="btn-outline" style={{ fontSize: 12.5, flex: 1 }} onClick={onReject}>
          忽略
        </button>
      </div>
    </div>
  );
}

/* ============ @引用选择器 ============ */
function MentionMenu({ query, type, anchorRef, onSelect, onClose }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const q = (query || '').toLowerCase();
    if (type === 'task') {
      setItems(DB.tasks((t) => !t.completed && !t.parent_id && t.title.toLowerCase().includes(q)).slice(0, 8));
    } else if (type === 'project') {
      setItems(DB.projects().filter((p) => p.name.toLowerCase().includes(q)).slice(0, 6));
    } else if (type === 'section') {
      const all = DB.projects().flatMap((p) => DB.sections(p.id).map((s) => ({ ...s, projectName: p.name })));
      setItems(all.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6));
    } else if (type === 'date') {
      const dates = [
        { id: 'today', name: '今天', date: DateU.today() },
        { id: 'tomorrow', name: '明天', date: DateU.addDays(DateU.today(), 1) },
        { id: 'next_week', name: '下周', date: DateU.addDays(DateU.today(), 7) },
      ].filter((d) => d.name.includes(query || ''));
      setItems(dates);
    }
  }, [query, type]);
  if (!items.length) return null;
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={260} maxHeight={280}>
      <div style={{ padding: 6 }}>
        {items.map((item) => (
          <button key={item.id} className="menu-item" onClick={() => onSelect(item)}>
            {type === 'task' && <><Icon name="check" size={14} /><span style={{ flex: 1 }}>{item.title}</span>{item.due_date && <span className="menu-hint">{DateU.human(item.due_date)}</span>}</>}
            {type === 'project' && <><Icon name="hash" size={14} style={{ color: item.color }} />{item.name}</>}
            {type === 'section' && <><Icon name="board" size={13} />{item.name} <span className="menu-hint">{item.projectName}</span></>}
            {type === 'date' && <><Icon name="calendar" size={14} />{item.name} <span className="menu-hint">{item.date}</span></>}
          </button>
        ))}
      </div>
    </Popover>
  );
}

/* ============ 指令菜单 / 触发 ============ */
const SLASH_CMDS = [
  { cmd: '/compact', desc: '压缩对话上下文', icon: 'compress' },
  { cmd: '/summarize', desc: '总结当前项目进展', icon: 'doc' },
  { cmd: '/advisor', desc: '切换为顾问模式', icon: 'brain' },
  { cmd: '/decompose', desc: '分解任务为子任务', icon: 'subtask' },
  { cmd: '/schedule', desc: '帮我安排本周计划', icon: 'calendar' },
  { cmd: '/memory', desc: '查看/编辑项目记忆', icon: 'archive' },
];

/* ============ 消息输入框（带 @ 和 / 提示） ============ */
function ChatInput({ onSend, disabled }) {
  const [val, setVal] = useState('');
  const [mention, setMention] = useState(null); // {type, query, triggerPos}
  const [showSlash, setShowSlash] = useState(false);
  const [refs, setRefs] = useState([]); // [{type, id, name, display}]
  const inputRef = useRef(null);
  const anchorRef = useRef(null);

  const handleChange = (e) => {
    const v = e.target.value;
    setVal(v);
    // 检测 @ 触发
    const atMatch = v.slice(0, e.target.selectionStart).match(/@(task:|project:|section:|date:|)(\S*)$/);
    if (atMatch) {
      const typeMap = { 'task:': 'task', 'project:': 'project', 'section:': 'section', 'date:': 'date', '': 'task' };
      setMention({ type: typeMap[atMatch[1]], query: atMatch[2], triggerPos: e.target.selectionStart - atMatch[0].length });
      setShowSlash(false);
    } else {
      setMention(null);
    }
    // 检测 / 命令
    if (v === '/' || v.startsWith('/') && !v.includes(' ')) {
      setShowSlash(true);
      setMention(null);
    } else if (!v.startsWith('/') || v.includes(' ')) {
      setShowSlash(false);
    }
  };

  const insertMention = (item) => {
    if (!mention) return;
    const prefix = val.slice(0, mention.triggerPos);
    const suffix = val.slice(inputRef.current.selectionStart);
    const pill = item.date ? item.name : (item.title || item.name);
    const newVal = prefix + '@' + pill + ' ' + suffix;
    setVal(newVal);
    setRefs((r) => [...r, { type: mention.type, id: item.id, name: pill, display: pill, date: item.date || null }]);
    setMention(null);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const execSlash = (cmd) => {
    setVal(cmd + ' ');
    setShowSlash(false);
    setTimeout(() => inputRef.current && inputRef.current.focus(), 0);
  };

  const send = () => {
    const text = val.trim();
    if (!text || disabled) return;
    onSend(text, refs);
    setVal('');
    setRefs([]);
  };

  const filteredCmds = SLASH_CMDS.filter((c) => c.cmd.includes(val.split(' ')[0]));

  return (
    <div style={{ position: 'relative' }} ref={anchorRef}>
      {mention && (
        <MentionMenu query={mention.query} type={mention.type} anchorRef={{ current: inputRef.current || anchorRef.current }}
          onSelect={insertMention} onClose={() => setMention(null)} />
      )}
      {showSlash && (
        <div className="popover" style={{ position: 'absolute', bottom: '100%', left: 0, right: 0, marginBottom: 6, padding: 6 }}>
          {filteredCmds.map((c) => (
            <button key={c.cmd} className="menu-item" onClick={() => execSlash(c.cmd)}>
              <Icon name={c.icon} size={14} /><strong style={{ fontFamily: 'var(--mono)', fontSize: 12.5 }}>{c.cmd}</strong>
              <span className="menu-hint">{c.desc}</span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {refs.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 2 }}>
              {refs.map((r, i) => (
                <span key={i} className="mention-pill">
                  {r.type === 'task' ? <Icon name="check" size={11} /> : r.type === 'project' ? <Icon name="hash" size={11} /> : <Icon name="calendar" size={11} />}
                  {r.name}
                  <button style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: 'var(--ai)', fontSize: 11, lineHeight: 1 }}
                    onClick={() => setRefs((arr) => arr.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={val}
            onChange={handleChange}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder={'发消息… 输入 @ 引用任务，/ 查看命令'}
            rows={1}
            disabled={disabled}
            style={{ border: 'none', outline: 'none', resize: 'none', background: 'none', fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.5, width: '100%', maxHeight: 120, overflowY: 'auto', fontFamily: 'var(--font)' }}
            onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          />
        </div>
        <button className="btn-icon" style={{ background: val.trim() ? 'var(--ai)' : 'var(--bg-inset)', color: val.trim() ? '#fff' : 'var(--text-tertiary)', borderRadius: 10, width: 36, height: 36, flex: 'none' }}
          onClick={send} disabled={!val.trim() || disabled}>
          <Icon name="send" size={16} />
        </button>
      </div>
    </div>
  );
}

/* ============ 主 AI 面板 ============ */
function AIPanel({ projectId: initProjectId, refTask, onClose, layout }) {
  const [projectId, setProjectId] = useState(initProjectId || 'inbox');
  const [convId, setConvId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [thinking, setThinking] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'memory' | 'agents'
  const [agentsContent, setAgentsContent] = useState('');
  const [agentsDirty, setAgentsDirty] = useState(false);
  const messagesEndRef = useRef(null);

  const proj = DB.project(projectId);

  // 初始化/切换项目时加载对话
  useEffect(() => {
    let convs = DB.conversations(projectId);
    if (!convs.length) {
      const c = DB.addConversation(projectId, '默认对话');
      convs = [c];
    }
    const c = convs[0];
    setConvId(c.id);
    setMessages(DB.messages(c.id));
    setAgentsContent(DB.agentsDoc(projectId));
    setAgentsDirty(false);
  }, [projectId]);

  useEffect(() => DB.subscribe(() => {
    if (convId) setMessages(DB.messages(convId));
  }), [convId]);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, thinking]);

  // 如果面板开时携带 refTask，预填 @引用
  const initialSent = useRef(false);
  useEffect(() => {
    if (refTask && !initialSent.current) {
      initialSent.current = true;
    }
  }, [refTask]);

  const buildSystemPrompt = () => {
    const tasks = DB.tasksInProject(projectId).slice(0, 30).map((t) =>
      `[${t.id.slice(-6)}] ${t.title}${t.due_date ? ' | 截止:' + t.due_date : ''}${t.priority < 4 ? ' | P' + t.priority : ''}${t.completed ? ' | ✓' : ''}`
    ).join('\n');
    const mems = DB.memories(projectId).map((m) => m.content).join('\n');
    const agents = DB.agentsDoc(projectId);
    return `你是一个智能任务助手，专注于项目「${proj?.name}」。

${agents ? '## AGENTS.md\n' + agents + '\n' : ''}${mems ? '## 项目记忆\n' + mems + '\n' : ''}## 当前任务列表\n${tasks || '（空）'}

你可以分析任务、建议优先级、分解复杂任务。当你建议创建/修改/完成任务时，在回复末尾加一个 JSON 块，格式：
\`\`\`proposals
[{"op":"create","title":"任务名","due_date":"YYYY-MM-DD","priority":2},...]
\`\`\`
op 可以是 create/update/complete/delete。update/complete/delete 需要带 task_id 字段。
用中文回复，简洁有力。`;
  };

  const send = async (text, refs) => {
    if (!convId || thinking) return;

    // 处理 /compact 指令
    if (text.startsWith('/compact')) {
      const msgs = DB.messages(convId);
      if (msgs.length < 4) return;
      const summary = '【已压缩】' + msgs.length + ' 条消息已归档，对话继续。';
      DB.clearMessages(convId, []);
      const systemMsg = DB.addMessage(convId, 'system', summary);
      if (proj) DB.addMemory(projectId, '对话摘要（' + new Date().toLocaleDateString('zh-CN') + '）：' + text.slice(9).trim() || '已压缩 ' + msgs.length + ' 条消息', 'compact');
      return;
    }

    // 构建引用上下文
    let refContext = '';
    if (refs && refs.length) {
      refContext = '\n\n引用：' + refs.map((r) => {
        if (r.type === 'task') { const t = DB.task(r.id); return t ? `任务「${t.title}」(${t.id.slice(-6)})` : r.name; }
        if (r.type === 'project') { const p = DB.project(r.id); return p ? `项目「${p.name}」` : r.name; }
        if (r.type === 'date') return `日期 ${r.date}`;
        return r.name;
      }).join(', ');
    }

    const userMsg = DB.addMessage(convId, 'user', text + refContext, { refs });
    setThinking(true);

    try {
      const history = DB.messages(convId).slice(-16).map((m) => ({ role: m.role === 'system' ? 'user' : m.role, content: m.content }));
      const response = await window.claude.complete(text + refContext, {
        system: buildSystemPrompt(),
        conversation: history.slice(0, -1),
      });

      // 解析提案 JSON
      let proposals = null;
      let cleanResponse = response;
      const propMatch = response.match(/```proposals\s*([\s\S]*?)```/);
      if (propMatch) {
        try { proposals = JSON.parse(propMatch[1]); } catch (e) {}
        cleanResponse = response.replace(/```proposals[\s\S]*?```/, '').trim();
      }

      DB.addMessage(convId, 'assistant', cleanResponse, { proposals });

      // 自动保存有价值的 AI 回复为记忆（每5条）
      const allMsgs = DB.messages(convId);
      if (allMsgs.length % 5 === 0 && allMsgs.length > 0) {
        DB.addMemory(projectId, '对话摘要（第 ' + allMsgs.length + ' 条）：' + cleanResponse.slice(0, 120), 'ai');
      }
    } catch (err) {
      DB.addMessage(convId, 'assistant', '抱歉，连接 AI 时出错：' + err.message);
    }
    setThinking(false);
  };

  const applyProposals = (proposals, msgId) => {
    proposals.forEach((p) => {
      if (p.op === 'create') {
        DB.addTask({ title: p.title, project_id: projectId, due_date: p.due_date || null, due_time: p.due_time || null, priority: p.priority || 4, description: p.description || '', labels: [] });
      } else if (p.op === 'update' && p.task_id) {
        DB.updateTask(p.task_id, p);
      } else if (p.op === 'complete' && p.task_id) {
        DB.toggleTask(p.task_id);
      } else if (p.op === 'delete' && p.task_id) {
        DB.deleteTask(p.task_id);
      }
    });
    DB.updateMessage(msgId, { proposals_applied: true });
  };

  const projects = DB.projects();

  /* ------- 面板内容 ------- */
  const panelContent = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 顶栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 10px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <Icon name="sparkle" size={16} style={{ color: 'var(--ai)' }} />
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}
          style={{ flex: 1, border: 'none', background: 'none', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', outline: 'none', cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 2 }}>
          {[['chat', '对话', 'chat'], ['memory', '记忆', 'brain'], ['agents', 'AGENTS', 'doc']].map(([t, l, ic]) => (
            <button key={t} className={'btn-ghost'} style={{ fontSize: 12, padding: '3px 8px', background: activeTab === t ? 'var(--ai-soft)' : 'none', color: activeTab === t ? 'var(--ai)' : 'var(--text-secondary)' }}
              onClick={() => setActiveTab(t)}>{l}</button>
          ))}
        </div>
        <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
      </div>

      {/* 内容区 */}
      {activeTab === 'chat' && (
        <>
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-tertiary)' }}>
                <Icon name="sparkle" size={32} strokeWidth={1.2} style={{ marginBottom: 8, opacity: .5 }} />
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 4 }}>和 AI 聊聊{proj ? '「' + proj.name + '」' : '任务'}</div>
                <div style={{ fontSize: 12, lineHeight: 1.6 }}>输入 <code style={{ background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4 }}>@</code> 引用任务，<code style={{ background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4 }}>/</code> 查看指令</div>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start', gap: 4 }}>
                {msg.role === 'system' && (
                  <div style={{ alignSelf: 'center', fontSize: 11.5, color: 'var(--text-tertiary)', padding: '3px 10px', background: 'var(--bg-inset)', borderRadius: 8 }}>{msg.content}</div>
                )}
                {msg.role !== 'system' && (
                  <div style={{
                    maxWidth: '88%', padding: '8px 12px', borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                    background: msg.role === 'user' ? 'var(--ai)' : 'var(--bg-card)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                    fontSize: 13.5, lineHeight: 1.55, border: msg.role === 'assistant' ? '1px solid var(--border-soft)' : 'none',
                  }}>
                    {msg.role === 'assistant' ? <MiniMd text={msg.content} /> : msg.content}
                  </div>
                )}
                {msg.proposals && !msg.proposals_applied && (
                  <ProposalCard proposals={msg.proposals} onApply={(ps) => applyProposals(ps, msg.id)} onReject={() => DB.updateMessage(msg.id, { proposals_applied: true })} />
                )}
                {msg.proposals_applied && (
                  <span style={{ fontSize: 11.5, color: 'var(--green)' }}><Icon name="check" size={12} /> 已应用</span>
                )}
              </div>
            ))}
            {thinking && (
              <div style={{ display: 'flex', gap: 5, padding: '8px 12px', background: 'var(--bg-card)', borderRadius: '4px 14px 14px 14px', width: 'fit-content', border: '1px solid var(--border-soft)' }}>
                {[0, 1, 2].map((i) => <span key={i} className="thinking-dot" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--ai)', display: 'block' }}></span>)}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--border-soft)', flexShrink: 0 }}>
            <ChatInput onSend={send} disabled={thinking} />
          </div>
        </>
      )}

      {activeTab === 'memory' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>项目记忆 · {DB.memories(projectId).length} 条</div>
          {DB.memories(projectId).map((m) => (
            <div key={m.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 9, padding: '8px 11px', marginBottom: 7, fontSize: 13 }}>
              <div style={{ color: 'var(--text-primary)', lineHeight: 1.5 }}>{m.content}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5 }}>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{new Date(m.created_at).toLocaleDateString('zh-CN')}</span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 6px' }}>{m.source}</span>
                <button className="btn-icon" style={{ width: 20, height: 20, marginLeft: 'auto' }} onClick={() => DB.deleteMemory(m.id)}><Icon name="trash" size={12} /></button>
              </div>
            </div>
          ))}
          <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
            onClick={() => { const c = prompt('添加记忆（不超过200字）：'); if (c) DB.addMemory(projectId, c, 'user'); }}>
            <Icon name="plus" size={14} /> 手动添加记忆
          </button>
        </div>
      )}

      {activeTab === 'agents' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '12px 14px', gap: 8 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>AGENTS.md — {proj?.name}</div>
          <textarea value={agentsContent}
            onChange={(e) => { setAgentsContent(e.target.value); setAgentsDirty(true); }}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '10px 12px', fontSize: 13, lineHeight: 1.65, fontFamily: 'var(--mono)', background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', resize: 'none' }}
            placeholder={'# AGENTS.md\n\n记录项目背景、约定、AI 协作规则…'} />
          {agentsDirty && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 13 }} onClick={() => { DB.setAgentsDoc(projectId, agentsContent); setAgentsDirty(false); }}>保存</button>
              <button className="btn-outline" style={{ flex: 1, fontSize: 13 }} onClick={() => { setAgentsContent(DB.agentsDoc(projectId)); setAgentsDirty(false); }}>取消</button>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ------- 三种布局 ------- */
  if (layout === 'sidebar') {
    // 方案A：右侧推入式侧边栏
    return (
      <div style={{ width: 360, height: '100%', borderLeft: '1px solid var(--border-soft)', background: 'var(--bg-card)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {panelContent}
      </div>
    );
  }
  if (layout === 'bottom') {
    // 方案B：底部抽屉
    return (
      <div style={{ position: 'fixed', bottom: 0, right: 0, left: 220, zIndex: 800, height: 400, background: 'var(--bg-card)', borderTop: '1px solid var(--border)', borderLeft: '1px solid var(--border)', boxShadow: '0 -6px 24px rgba(0,0,0,.12)', animation: 'pop-in .16s ease-out' }}>
        {panelContent}
      </div>
    );
  }
  // 方案C（默认）：浮动面板
  return (
    <div style={{ position: 'fixed', right: 20, bottom: 86, width: 380, height: 520, zIndex: 900, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border-soft)', boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden', animation: 'pop-in .16s ease-out' }}>
      {panelContent}
    </div>
  );
}

Object.assign(window, { AIPanel, MiniMd });
