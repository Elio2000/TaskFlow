/* ui.jsx — 日期工具、弹层基建、各类选择器、任务行基础件 */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ============ 日期工具 ============ */
const DateU = {
  pad: (n) => String(n).padStart(2, '0'),
  fmt(d) { return d.getFullYear() + '-' + this.pad(d.getMonth() + 1) + '-' + this.pad(d.getDate()); },
  parse(s) { return new Date(s + 'T00:00:00'); },
  today() { return this.fmt(new Date()); },
  addDays(s, n) { const d = this.parse(s); d.setDate(d.getDate() + n); return this.fmt(d); },
  weekdayCN(s) { return ['日', '一', '二', '三', '四', '五', '六'][this.parse(s).getDay()]; },
  /* 人类可读：今天 / 明天 / 周三 / 6月18日 */
  human(s) {
    if (!s) return '';
    const t = this.today();
    if (s === t) return '今天';
    if (s === this.addDays(t, 1)) return '明天';
    if (s === this.addDays(t, -1)) return '昨天';
    const d = this.parse(s);
    const diff = (d - this.parse(t)) / 86400000;
    if (diff > 1 && diff < 7) return '周' + this.weekdayCN(s);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return (sameYear ? '' : d.getFullYear() + '年') + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },
  isOverdue(s) { return s && s < this.today(); },
  monthGrid(year, month) {
    // 返回 6x7 网格（周一开头）
    const first = new Date(year, month, 1);
    let startOffset = first.getDay() === 0 ? 6 : first.getDay() - 1;
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(year, month, 1 - startOffset + i);
      cells.push({ date: this.fmt(d), day: d.getDate(), inMonth: d.getMonth() === month });
    }
    return cells;
  },
};

/* ============ Popover 基建 ============ */
function Popover({ anchorRef, onClose, children, width, align = 'left', maxHeight }) {
  const popRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    const a = anchorRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const w = width || 280;
    let left = align === 'right' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    setPos({ left, top, width: w });
  }, []);
  useEffect(() => {
    const onDown = (e) => { if (popRef.current && !popRef.current.contains(e.target) && !(anchorRef.current && anchorRef.current.contains(e.target))) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true); };
  }, []);
  // 翻转：超出底部则显示在上方
  useEffect(() => {
    if (!pos || !popRef.current) return;
    const h = popRef.current.offsetHeight;
    if (pos.top + h > window.innerHeight - 8) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos((p) => ({ ...p, top: Math.max(8, r.top - h - 6) }));
    }
  }, [pos && pos.top]);
  if (!pos) return null;
  return ReactDOM.createPortal(
    <div ref={popRef} className="popover" style={{ left: pos.left, top: pos.top, width: pos.width, maxHeight: maxHeight || 'min(480px, 80vh)', overflowY: 'auto' }}>
      {children}
    </div>, document.body);
}

/* 通用：按钮 + 弹层 组合 hook */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  return { open, setOpen, ref, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}

/* ============ 日期选择器 ============ */
function DateMenu({ value, time, repeat, onPick, onClose, anchorRef }) {
  const t = DateU.today();
  const [view, setView] = useState(() => { const d = value ? DateU.parse(value) : new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [text, setText] = useState('');
  const [timeVal, setTimeVal] = useState(time || '');
  const [repeatVal, setRepeatVal] = useState(repeat || null);
  const parsed = text ? NLP.parse(text, {}) : null;

  const quick = [
    { label: '今天', date: t, hint: '周' + DateU.weekdayCN(t), icon: 'today' },
    { label: '明天', date: DateU.addDays(t, 1), hint: '周' + DateU.weekdayCN(DateU.addDays(t, 1)), icon: 'sun' },
    { label: '下周一', date: DateU.fmt((() => { const d = new Date(); d.setDate(d.getDate() + ((8 - (d.getDay() || 7)) || 7)); return d; })()), hint: '', icon: 'upcoming' },
    { label: '不设日期', date: null, hint: '', icon: 'circleDashed' },
  ];
  const grid = DateU.monthGrid(view.y, view.m);
  const commit = (date) => onPick({ due_date: date, due_time: date ? (timeVal || null) : null, repeat: date ? repeatVal : null });

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={272}>
      <div style={{ padding: 10 }}>
        <input
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder="输入日期，如「下周三」「6月20日」"
          onKeyDown={(e) => { if (e.key === 'Enter' && parsed && parsed.due_date) commit(parsed.due_date); }}
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--bg-content)', outline: 'none' }} />
        {parsed && parsed.due_date && (
          <button className="menu-item" style={{ marginTop: 6, color: 'var(--accent-text)' }} onClick={() => commit(parsed.due_date)}>
            <Icon name="calendar" size={15} /> {DateU.human(parsed.due_date)}
            <span className="menu-hint">回车确认</span>
          </button>
        )}
        {!text && (
          <div style={{ marginTop: 6 }}>
            {quick.map((q) => (
              <button key={q.label} className="menu-item" onClick={() => commit(q.date)}>
                <Icon name={q.icon} size={15} style={{ color: q.date === t ? 'var(--green)' : 'var(--text-secondary)' }} />
                {q.label}<span className="menu-hint">{q.hint}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 6px' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{view.y}年{view.m + 1}月</span>
            <span style={{ display: 'flex', gap: 2 }}>
              <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setView((v) => ({ y: v.m === 0 ? v.y - 1 : v.y, m: v.m === 0 ? 11 : v.m - 1 }))}><Icon name="chevronLeft" size={14} /></button>
              <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setView((v) => ({ y: v.m === 11 ? v.y + 1 : v.y, m: v.m === 11 ? 0 : v.m + 1 }))}><Icon name="chevronRight" size={14} /></button>
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 3 }}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {grid.map((c) => {
              const sel = c.date === value, isToday = c.date === t;
              return (
                <button key={c.date} onClick={() => commit(c.date)}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 0', fontSize: 12.5,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel ? '#fff' : isToday ? 'var(--accent-text)' : c.inMonth ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: isToday || sel ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'transparent'; }}
                >{c.day}</button>
              );
            })}
          </div>
        </div>
        <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8, display: 'flex', gap: 6 }}>
          <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--text-secondary)', border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px' }}>
            <Icon name="clock" size={14} />
            <input type="time" value={timeVal} onChange={(e) => setTimeVal(e.target.value)} style={{ border: 'none', background: 'none', outline: 'none', fontSize: 12.5, width: '100%' }} />
          </label>
          <select value={repeatVal || ''} onChange={(e) => setRepeatVal(e.target.value || null)}
            style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '5px 8px', fontSize: 12.5, background: 'var(--bg-card)', color: 'var(--text-secondary)', outline: 'none' }}>
            <option value="">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
        </div>
        {(timeVal || repeatVal) && value && (
          <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => commit(value)}>应用</button>
        )}
      </div>
    </Popover>
  );
}

/* ============ 优先级选择 ============ */
function PriorityMenu({ anchorRef, onPick, onClose }) {
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={170}>
      <div style={{ padding: 6 }}>
        {[1, 2, 3, 4].map((p) => (
          <button key={p} className="menu-item" onClick={() => onPick(p)}>
            <Icon name="flag" size={15} style={{ color: PRIORITY_META[p].color }} />
            {PRIORITY_META[p].name}
            <span className="menu-hint">p{p}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

/* ============ 标签选择 ============ */
function LabelMenu({ anchorRef, onClose, selected, onToggle }) {
  const labels = DB.labels();
  const [q, setQ] = useState('');
  const shown = labels.filter((l) => l.name.includes(q));
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={220}>
      <div style={{ padding: 6 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索或新建标签"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 9px', fontSize: 13, background: 'var(--bg-content)', outline: 'none', marginBottom: 4 }} />
        {shown.map((l) => (
          <button key={l.id} className="menu-item" onClick={() => onToggle(l.id)}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: l.color, flex: 'none' }}></span>
            {l.name}
            {selected.includes(l.id) && <span className="menu-hint"><Icon name="check" size={14} /></span>}
          </button>
        ))}
        {q && !labels.some((l) => l.name === q) && (
          <button className="menu-item" style={{ color: 'var(--accent-text)' }} onClick={() => { const l = DB.addLabel(q); onToggle(l.id); setQ(''); }}>
            <Icon name="plus" size={14} /> 新建「{q}」
          </button>
        )}
      </div>
    </Popover>
  );
}

/* ============ 项目/分区选择 ============ */
function ProjectMenu({ anchorRef, onClose, onPick }) {
  const projects = DB.projects();
  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={240}>
      <div style={{ padding: 6 }}>
        {projects.map((p) => {
          const secs = DB.sections(p.id);
          return (
            <div key={p.id}>
              <button className="menu-item" onClick={() => onPick(p.id, null)}>
                {p.id === 'inbox' ? <Icon name="inbox" size={15} /> : <Icon name="hash" size={15} style={{ color: p.color }} />}
                {p.name}
              </button>
              {secs.map((s) => (
                <button key={s.id} className="menu-item" style={{ paddingLeft: 32, fontSize: 13, color: 'var(--text-secondary)' }} onClick={() => onPick(p.id, s.id)}>
                  <Icon name="board" size={13} /> {s.name}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}

/* ============ 勾选圈 ============ */
function TaskCheckbox({ task, size = 18 }) {
  const c = task.priority < 4 ? PRIORITY_META[task.priority].color : 'var(--text-tertiary)';
  return (
    <button
      className={'checkbox-circle' + (task.completed ? ' is-checked' : '')}
      style={{ borderColor: c, background: task.completed ? c : (task.priority < 4 ? PRIORITY_META[task.priority].color.replace(')', ' / 0.1)').replace('var(--p', 'var(--p') : 'transparent'), width: size, height: size }}
      onClick={(e) => { e.stopPropagation(); DB.toggleTask(task.id); }}
      aria-label={task.completed ? '标记未完成' : '完成任务'}
    >
      <Icon name="check" size={size - 6} strokeWidth={2.4} style={{ color: task.completed ? '#fff' : c }} />
    </button>
  );
}

/* ============ 任务元信息 chips ============ */
function TaskChips({ task, showProject }) {
  const proj = DB.project(task.project_id);
  const sec = task.section_id ? DB.section(task.section_id) : null;
  const subs = DB.subtasks(task.id);
  const doneSubs = subs.filter((s) => s.completed).length;
  const overdue = !task.completed && DateU.isOverdue(task.due_date);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4, alignItems: 'center' }}>
      {task.due_date && (
        <span className="chip" style={{ color: overdue ? 'var(--p1)' : task.due_date === DateU.today() ? 'var(--green)' : undefined, background: overdue ? 'var(--accent-soft)' : undefined }}>
          <Icon name="calendar" size={12} />{DateU.human(task.due_date)}{task.due_time ? ' ' + task.due_time : ''}
        </span>
      )}
      {task.repeat && <span className="chip"><Icon name="repeat" size={12} />{{ daily: '每天', weekly: '每周', monthly: '每月' }[task.repeat]}</span>}
      {subs.length > 0 && <span className="chip"><Icon name="subtask" size={12} />{doneSubs}/{subs.length}</span>}
      {task.labels.map((id) => { const l = DB.label(id); return l ? <span key={id} className="chip"><span style={{ width: 7, height: 7, borderRadius: '50%', background: l.color }}></span>{l.name}</span> : null; })}
      {task.reminder && <span className="chip"><Icon name="bell" size={12} />{task.reminder}</span>}
      {showProject && proj && (
        <span className="chip" style={{ marginLeft: 'auto', background: 'none' }}>
          {proj.name}{sec ? ' / ' + sec.name : ''}
          <Icon name="hash" size={11} style={{ color: proj.color }} />
        </span>
      )}
    </div>
  );
}

Object.assign(window, { DateU, Popover, usePopover, DateMenu, PriorityMenu, LabelMenu, ProjectMenu, TaskCheckbox, TaskChips });
