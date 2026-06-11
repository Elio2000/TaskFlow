/* composer.jsx — 快速添加（NLP Copilot）+ 任务完整编辑 Modal */
const { useState, useEffect, useRef, useCallback } = React;

/* ====================================================
   NLP Copilot 输入条
   ==================================================== */
function QuickComposer({ projectId, sectionId, onDone, placeholder, autoFocus }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const inputRef = useRef(null);

  const ctx = { projects: DB.projects(), labels: DB.labels() };

  useEffect(() => {
    if (text.trim()) setParsed(NLP.parse(text, ctx));
    else setParsed(null);
  }, [text]);

  const submit = () => {
    if (!parsed || !parsed.title) return;
    const task = DB.addTask({
      title: parsed.title,
      project_id: parsed.project_id || projectId || 'inbox',
      section_id: sectionId || null,
      due_date: parsed.due_date,
      due_time: parsed.due_time,
      priority: parsed.priority || 4,
      labels: parsed.label_ids || [],
      repeat: parsed.repeat,
    });
    setText('');
    if (onDone) onDone(task);
    // 如果 shift+enter → 打开详情
    if (showDetail) { window.__openTaskModal && window.__openTaskModal(task.id); setShowDetail(false); }
  };

  const TokenPreview = () => {
    if (!parsed || !text) return null;
    const chips = [];
    if (parsed.due_date) chips.push({ color: 'var(--accent-text)', bg: 'var(--accent-soft)', text: DateU.human(parsed.due_date) + (parsed.due_time ? ' ' + parsed.due_time : '') });
    if (parsed.repeat) chips.push({ color: 'var(--accent-text)', bg: 'var(--accent-soft)', text: { daily: '每天', weekly: '每周', monthly: '每月' }[parsed.repeat] });
    if (parsed.priority && parsed.priority < 4) chips.push({ color: PRIORITY_META[parsed.priority].color, bg: 'var(--bg-inset)', text: 'P' + parsed.priority });
    if (parsed.project_id) { const p = DB.project(parsed.project_id); if (p) chips.push({ color: 'var(--ai)', bg: 'var(--ai-soft)', text: p.name }); }
    parsed.label_ids.forEach((id) => { const l = DB.label(id); if (l) chips.push({ color: 'var(--p3)', bg: 'rgba(91,127,166,.13)', text: l.name }); });
    if (!chips.length) return null;
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '0 12px 8px' }}>
        {chips.map((c, i) => (
          <span key={i} style={{ fontSize: 11.5, padding: '2px 7px', borderRadius: 5, background: c.bg, color: c.color, fontWeight: 500 }}>{c.text}</span>
        ))}
      </div>
    );
  };

  return (
    <div className="composer" style={{ margin: '0 0 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '8px 10px 8px 12px' }}>
        <Icon name="plus" size={16} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
        <input
          ref={inputRef}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (e.shiftKey) { setShowDetail(true); setTimeout(submit, 0); }
              else submit();
            }
            if (e.key === 'Escape') { setText(''); if (onDone) onDone(null); }
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
            <kbd style={{ background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--mono)', fontSize: 11 }}>⇧ Enter</kbd> 添加并编辑
            &nbsp;&nbsp;
            <kbd style={{ background: 'var(--bg-inset)', borderRadius: 4, padding: '1px 5px', fontFamily: 'var(--mono)', fontSize: 11 }}>Esc</kbd> 取消
          </span>
        </div>
      )}
    </div>
  );
}

/* ====================================================
   任务详情/编辑 Modal
   ==================================================== */
function TaskModal({ taskId, onClose }) {
  const [task, setTask] = useState(() => DB.task(taskId));
  const [editTitle, setEditTitle] = useState(false);
  const [titleVal, setTitleVal] = useState('');
  const [descVal, setDescVal] = useState('');
  const [newSub, setNewSub] = useState('');
  const [reminderVal, setReminderVal] = useState('');
  const titleRef = useRef(null);
  const dp = usePopover(), pp = usePopover(), lp = usePopover(), projp = usePopover();

  // 订阅 DB 更新
  useEffect(() => {
    const unsub = DB.subscribe(() => setTask(DB.task(taskId)));
    return unsub;
  }, [taskId]);

  useEffect(() => {
    if (task) { setTitleVal(task.title); setDescVal(task.description || ''); setReminderVal(task.reminder || ''); }
  }, [task && task.id]);

  if (!task) return null;

  const proj = DB.project(task.project_id);
  const sec = task.section_id ? DB.section(task.section_id) : null;
  const subtasks = DB.subtasks(task.id);

  const save = (patch) => DB.updateTask(taskId, patch);

  const addSubtask = () => {
    if (!newSub.trim()) return;
    DB.addTask({ title: newSub.trim(), parent_id: taskId, project_id: task.project_id, priority: 4 });
    setNewSub('');
  };

  const pc = PRIORITY_META[task.priority];

  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card fade-up"
        style={{ width: 'min(680px, 95vw)', maxHeight: '88vh', overflowY: 'auto', marginTop: '6vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 18px 12px', borderBottom: '1px solid var(--border-soft)' }}>
          <TaskCheckbox task={task} size={20} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {editTitle ? (
              <input autoFocus value={titleVal}
                onChange={(e) => setTitleVal(e.target.value)}
                onBlur={() => { if (titleVal.trim()) save({ title: titleVal.trim() }); setEditTitle(false); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { if (titleVal.trim()) save({ title: titleVal.trim() }); setEditTitle(false); } if (e.key === 'Escape') { setTitleVal(task.title); setEditTitle(false); } }}
                style={{ width: '100%', border: 'none', outline: 'none', background: 'none', fontSize: 17, fontWeight: 600, color: 'var(--text-primary)' }} />
            ) : (
              <div onClick={() => setEditTitle(true)} style={{ fontSize: 17, fontWeight: 600, cursor: 'text', color: task.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: task.completed ? 'line-through' : 'none', lineHeight: 1.4 }}>
                {task.title || <span style={{ color: 'var(--text-tertiary)' }}>点击编辑标题</span>}
              </div>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}><Icon name="x" size={16} /></button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', flex: 1, minHeight: 0 }}>
          {/* 左：描述 + 子任务 */}
          <div style={{ padding: '14px 18px', borderRight: '1px solid var(--border-soft)', overflowY: 'auto' }}>
            <textarea
              value={descVal}
              onChange={(e) => setDescVal(e.target.value)}
              onBlur={() => save({ description: descVal })}
              placeholder="添加描述…"
              style={{ width: '100%', minHeight: 90, resize: 'vertical', border: '1px solid transparent', borderRadius: 8, padding: '8px 10px', fontSize: 13.5, background: 'transparent', color: 'var(--text-primary)', outline: 'none', fontFamily: 'var(--font)', lineHeight: 1.6 }}
              onFocus={(e) => e.target.style.borderColor = 'var(--border)'}
            />

            {/* 子任务 */}
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Icon name="subtask" size={14} style={{ color: 'var(--text-tertiary)' }} />
                <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-secondary)' }}>子任务</span>
                {subtasks.length > 0 && <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>{subtasks.filter(s => s.completed).length}/{subtasks.length}</span>}
              </div>
              {subtasks.map((sub) => (
                <div key={sub.id} className="task-row" style={{ padding: '7px 4px' }}>
                  <TaskCheckbox task={sub} size={16} />
                  <span style={{ fontSize: 13.5, flex: 1, color: sub.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: sub.completed ? 'line-through' : 'none' }}>{sub.title}</span>
                  <button className="btn-icon" style={{ width: 24, height: 24, opacity: 0.4 }} onClick={() => DB.deleteTask(sub.id)}>
                    <Icon name="x" size={13} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <input value={newSub} onChange={(e) => setNewSub(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addSubtask(); }}
                  placeholder="添加子任务…"
                  style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none' }} />
                <button className="btn-outline" style={{ padding: '6px 12px' }} onClick={addSubtask}><Icon name="plus" size={14} /></button>
              </div>
            </div>
          </div>

          {/* 右：属性列 */}
          <div style={{ padding: '14px 14px', overflowY: 'auto' }}>
            {/* 项目 */}
            <PropRow label="项目" icon="hash">
              <button ref={projp.ref} className="btn-ghost" style={{ fontSize: 13, padding: '3px 7px' }} onClick={projp.toggle}>
                {proj ? <><span style={{ width: 9, height: 9, borderRadius: '50%', background: proj.color, display: 'inline-block' }}></span> {proj.name}{sec ? ' / ' + sec.name : ''}</> : '无'}
              </button>
              {projp.open && <ProjectMenu anchorRef={projp.ref} onClose={projp.close} onPick={(pid, sid) => { save({ project_id: pid, section_id: sid }); projp.close(); }} />}
            </PropRow>

            {/* 起始日期（可选，多天跨度） */}
            <PropRow label="开始" icon="upcoming">
              <button ref={{current: null}} className="btn-ghost" style={{ fontSize: 13, padding: '3px 7px' }}
                onClick={() => {
                  const v = window.prompt('开始日期 (YYYY-MM-DD)，留空清除：', task.start_date||'');
                  if (v !== null) save({ start_date: v.trim() || null });
                }}>
                {task.start_date ? DateU.human(task.start_date) : '无（单天）'}
              </button>
            </PropRow>
            {/* 截止日期 */}
            <PropRow label="截止日期" icon="calendar">
              <button ref={dp.ref} className="btn-ghost" style={{ fontSize: 13, padding: '3px 7px', color: DateU.isOverdue(task.due_date) ? 'var(--p1)' : task.due_date === DateU.today() ? 'var(--green)' : undefined }} onClick={dp.toggle}>
                {task.due_date ? DateU.human(task.due_date) + (task.due_time ? ' ' + task.due_time : '') : '无日期'}
              </button>
              {dp.open && <DateMenu anchorRef={dp.ref} value={task.due_date} time={task.due_time} repeat={task.repeat} onPick={(v) => { save(v); dp.close(); }} onClose={dp.close} />}
            </PropRow>

            {/* 优先级 */}
            <PropRow label="优先级" icon="flag">
              <button ref={pp.ref} className="btn-ghost" style={{ fontSize: 13, padding: '3px 7px', color: pc.color }} onClick={pp.toggle}>
                <Icon name="flag" size={13} style={{ color: pc.color }} /> {pc.name}
              </button>
              {pp.open && <PriorityMenu anchorRef={pp.ref} onClose={pp.close} onPick={(p) => { save({ priority: p }); pp.close(); }} />}
            </PropRow>

            {/* 标签 */}
            <PropRow label="标签" icon="tag">
              <button ref={lp.ref} className="btn-ghost" style={{ fontSize: 13, padding: '3px 7px' }} onClick={lp.toggle}>
                {task.labels.length > 0
                  ? task.labels.map((id) => { const l = DB.label(id); return l ? <span key={id} style={{ marginRight: 4 }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color, display: 'inline-block', marginRight: 3 }}></span>{l.name}</span> : null; })
                  : '无标签'}
              </button>
              {lp.open && <LabelMenu anchorRef={lp.ref} onClose={lp.close} selected={task.labels} onToggle={(id) => { const arr = task.labels.includes(id) ? task.labels.filter((x) => x !== id) : [...task.labels, id]; save({ labels: arr }); }} />}
            </PropRow>

            {/* 提醒 */}
            <PropRow label="提醒" icon="bell">
              <select value={reminderVal} onChange={(e) => { setReminderVal(e.target.value); save({ reminder: e.target.value || null }); }}
                style={{ border: '1px solid var(--border)', borderRadius: 7, padding: '4px 8px', fontSize: 12.5, background: 'var(--bg-card)', color: 'var(--text-secondary)', outline: 'none' }}>
                <option value="">无</option>
                <option value="due_time">准时</option>
                <option value="5min">提前5分钟</option>
                <option value="30min">提前30分钟</option>
                <option value="1h">提前1小时</option>
                <option value="1d">提前1天</option>
              </select>
            </PropRow>

            {/* 分隔 */}
            <div style={{ borderTop: '1px solid var(--border-soft)', margin: '12px 0' }} />

            {/* 删除 */}
            <button className="btn-ghost" style={{ color: 'var(--p1)', width: '100%', justifyContent: 'flex-start' }}
              onClick={() => { DB.deleteTask(task.id); onClose(); }}>
              <Icon name="trash" size={14} /> 删除任务
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 18px', borderTop: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)' }}>
            创建于 {new Date(task.created_at).toLocaleDateString('zh-CN')}
            {task.completed_at ? ' · 完成于 ' + new Date(task.completed_at).toLocaleDateString('zh-CN') : ''}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn-ghost" style={{ fontSize: 12.5 }} onClick={() => { window.__openAI && window.__openAI(task.project_id, task); }}>
              <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} /> 让 AI 处理
            </button>
            <button className="btn-primary" style={{ fontSize: 12.5, padding: '5px 14px' }} onClick={onClose}>完成</button>
          </span>
        </div>
      </div>
    </div>
  );
}

function PropRow({ label, icon, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10, minHeight: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, width: 64, paddingTop: 4, flex: 'none' }}>
        <Icon name={icon} size={13} style={{ color: 'var(--text-tertiary)' }} />
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{label}</span>
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

Object.assign(window, { QuickComposer, TaskModal });
