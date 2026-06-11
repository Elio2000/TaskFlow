/* views.jsx — Inbox / Today / Upcoming / Calendar / Board / List */
const { useState, useEffect, useRef, useMemo } = React;

/* ====================================================
   共用：通用任务行
   ==================================================== */
function TaskRow({ task, showProject, onClick }) {
  const pc = PRIORITY_META[task.priority];
  return (
    <div className={'task-row' + (task.completed ? ' is-done' : '')} onClick={() => onClick && onClick(task)}>
      <TaskCheckbox task={task} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="task-title">{task.title}</div>
        <TaskChips task={task} showProject={showProject} />
      </div>
      <div className="task-actions" style={{ display: 'flex', gap: 2, paddingTop: 2 }}>
        <button className="btn-icon" style={{ width: 26, height: 26 }}
          onClick={(e) => { e.stopPropagation(); window.__openAI && window.__openAI(task.project_id, task); }}
          title="AI 处理">
          <Icon name="sparkle" size={14} style={{ color: 'var(--ai)' }} />
        </button>
        <button className="btn-icon" style={{ width: 26, height: 26 }}
          onClick={(e) => { e.stopPropagation(); DB.deleteTask(task.id); }}
          title="删除">
          <Icon name="trash" size={14} />
        </button>
      </div>
    </div>
  );
}

/* 分组容器 */
function TaskGroup({ title, tasks, showProject, onOpenTask, defaultOpen = true, accent }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 18 }}>
      <button onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', marginBottom: open ? 4 : 0 }}>
        <Icon name="chevronRight" size={14} style={{ color: 'var(--text-tertiary)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: accent || 'var(--text-secondary)' }}>{title}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
      </button>
      {open && tasks.map((t) => <TaskRow key={t.id} task={t} showProject={showProject} onClick={onOpenTask} />)}
    </div>
  );
}

/* 视图包装 */
function ViewShell({ title, subtitle, actions, children }) {
  return (
    <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', background: 'var(--bg-content)' }}>
      <div style={{ padding: '28px 32px 14px', borderBottom: '1px solid var(--border-soft)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>{title}</h1>
            {subtitle && <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 3 }}>{subtitle}</div>}
          </div>
          {actions}
        </div>
      </div>
      <div style={{ padding: '20px 32px 32px' }}>
        {children}
      </div>
    </div>
  );
}

/* ====================================================
   Inbox 视图
   ==================================================== */
function InboxView({ onOpenTask }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const tasks = DB.tasksInProject('inbox');
  return (
    <ViewShell title="收件箱" subtitle={tasks.length ? tasks.length + ' 条任务' : '干净如新'}>
      <QuickComposer projectId="inbox" placeholder="添加到收件箱… 试试「明天 p2 整理文件」" />
      {tasks.length === 0
        ? <EmptyState icon="inbox" text="收件箱已清空" sub="处理完所有任务，真不错！" />
        : tasks.map((t) => <TaskRow key={t.id} task={t} onClick={onOpenTask} />)
      }
    </ViewShell>
  );
}

/* ====================================================
   Today 视图
   ==================================================== */
function TodayView({ onOpenTask }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const today = DateU.today();
  const todayTasks = DB.tasksOnDate(today);
  const overdue = DB.overdueTasks();
  const done = DB.tasksOnDate(today, true).filter((t) => t.completed);
  return (
    <ViewShell title="今天" subtitle={new Date().toLocaleDateString('zh-CN', { weekday: 'long', month: 'long', day: 'numeric' })}>
      <QuickComposer projectId="inbox" placeholder="添加今天的任务…" />
      {overdue.length > 0 && <TaskGroup title="逾期" tasks={overdue} showProject onOpenTask={onOpenTask} accent="var(--p1)" />}
      {todayTasks.length > 0
        ? <TaskGroup title="今天" tasks={todayTasks} showProject onOpenTask={onOpenTask} />
        : overdue.length === 0 && <EmptyState icon="today" text="今天没有安排" sub="好好休息，或者添加些任务" />
      }
      {done.length > 0 && <TaskGroup title="已完成" tasks={done} showProject onOpenTask={onOpenTask} defaultOpen={false} />}
    </ViewShell>
  );
}

/* ====================================================
   Upcoming 周列表视图
   ==================================================== */
function UpcomingView({ onOpenTask }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const [baseDate, setBaseDate] = useState(() => {
    const d = new Date(); d.setHours(0,0,0,0); return d;
  });
  // 生成未来14天
  const days = useMemo(() => {
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(baseDate); d.setDate(d.getDate() + i);
      const ds = DateU.fmt(d);
      return { date: ds, label: DateU.human(ds), weekday: '周' + DateU.weekdayCN(ds), tasks: DB.tasksOnDate(ds) };
    });
  }, [baseDate, tick]);
  return (
    <ViewShell title="即将到来"
      actions={<span style={{ display: 'flex', gap: 6 }}>
        <button className="btn-ghost" onClick={() => { const d = new Date(baseDate); d.setDate(d.getDate() - 7); setBaseDate(d); }}><Icon name="chevronLeft" size={15} /></button>
        <button className="btn-ghost" onClick={() => { setBaseDate(new Date()); }}>今天</button>
        <button className="btn-ghost" onClick={() => { const d = new Date(baseDate); d.setDate(d.getDate() + 7); setBaseDate(d); }}><Icon name="chevronRight" size={15} /></button>
      </span>}>
      {days.map((day) => (
        <div key={day.date} style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, borderBottom: '1px solid var(--border-soft)', paddingBottom: 6 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: day.date === DateU.today() ? 'var(--accent-text)' : 'var(--text-primary)' }}>
              {day.label}
            </span>
            <span style={{ fontSize: 12.5, color: 'var(--text-tertiary)' }}>{day.weekday} · {day.date}</span>
          </div>
          {day.tasks.length === 0
            ? <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', padding: '4px 0 4px 4px' }}>暂无任务</div>
            : day.tasks.map((t) => <TaskRow key={t.id} task={t} showProject onClick={onOpenTask} />)
          }
          <QuickComposer projectId="inbox" placeholder="+ 为这天添加任务" autoFocus={false} />
        </div>
      ))}
    </ViewShell>
  );
}

/* ====================================================
   Calendar 月历视图
   ==================================================== */
function CalendarView({ onOpenTask }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const [cur, setCur] = useState(() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; });
  const [selected, setSelected] = useState(DateU.today());
  const today = DateU.today();
  const grid = DateU.monthGrid(cur.y, cur.m);
  const tasksByDate = useMemo(() => {
    const map = {};
    DB.tasks((t) => !t.completed && !t.parent_id && t.due_date).forEach((t) => {
      if (!map[t.due_date]) map[t.due_date] = [];
      map[t.due_date].push(t);
    });
    return map;
  }, [tick]);
  const dayTasks = DB.tasksOnDate(selected);
  const monthName = new Date(cur.y, cur.m).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  return (
    <ViewShell title={monthName}
      actions={<span style={{ display: 'flex', gap: 6 }}>
        <button className="btn-ghost" onClick={() => setCur((c) => ({ y: c.m === 0 ? c.y - 1 : c.y, m: c.m === 0 ? 11 : c.m - 1 }))}><Icon name="chevronLeft" size={15} /></button>
        <button className="btn-ghost" onClick={() => { const d = new Date(); setCur({ y: d.getFullYear(), m: d.getMonth() }); setSelected(today); }}>今天</button>
        <button className="btn-ghost" onClick={() => setCur((c) => ({ y: c.m === 11 ? c.y + 1 : c.y, m: c.m === 11 ? 0 : c.m + 1 }))}><Icon name="chevronRight" size={15} /></button>
      </span>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24, minHeight: 0 }}>
        {/* 月历网格 */}
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 0, marginBottom: 4 }}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <div key={w} style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)', padding: '4px 0', fontWeight: 500 }}>{w}</div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
            {grid.map((c) => {
              const ts = tasksByDate[c.date] || [];
              const isSel = c.date === selected, isToday = c.date === today;
              return (
                <div key={c.date}
                  onClick={() => setSelected(c.date)}
                  style={{
                    minHeight: 70, borderRadius: 8, padding: '5px 6px', cursor: 'pointer',
                    background: isSel ? 'var(--accent-soft)' : isToday ? 'var(--bg-hover)' : c.inMonth ? 'var(--bg-card)' : 'transparent',
                    border: isSel ? '1.5px solid var(--accent)' : '1px solid var(--border-soft)',
                    opacity: c.inMonth ? 1 : 0.4,
                  }}>
                  <div style={{ fontSize: 12.5, fontWeight: isToday || isSel ? 700 : 400, color: isToday ? 'var(--accent-text)' : isSel ? 'var(--accent-text)' : 'var(--text-primary)', marginBottom: 3, textAlign: 'right' }}>{c.day}</div>
                  {ts.slice(0, 3).map((t) => (
                    <div key={t.id} onClick={(e) => { e.stopPropagation(); onOpenTask && onOpenTask(t); }}
                      style={{ fontSize: 11, lineHeight: 1.3, padding: '2px 4px', borderRadius: 4, marginBottom: 2, background: 'var(--bg-inset)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: PRIORITY_META[t.priority].color, display: 'inline-block', marginRight: 3 }}></span>
                      {t.title}
                    </div>
                  ))}
                  {ts.length > 3 && <div style={{ fontSize: 10.5, color: 'var(--text-tertiary)', paddingLeft: 4 }}>+{ts.length - 3} 条</div>}
                </div>
              );
            })}
          </div>
        </div>
        {/* 右侧：当天任务 */}
        <div style={{ borderLeft: '1px solid var(--border-soft)', paddingLeft: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5, marginBottom: 10, color: selected === today ? 'var(--accent-text)' : 'var(--text-primary)' }}>
            {DateU.human(selected)} <span style={{ fontWeight: 400, fontSize: 12.5, color: 'var(--text-tertiary)' }}>({dayTasks.length} 条)</span>
          </div>
          <QuickComposer projectId="inbox" placeholder="为这天添加任务…" autoFocus={false} />
          {dayTasks.length === 0
            ? <div style={{ fontSize: 13, color: 'var(--text-tertiary)', paddingTop: 8 }}>无任务</div>
            : dayTasks.map((t) => <TaskRow key={t.id} task={t} showProject onClick={onOpenTask} />)
          }
        </div>
      </div>
    </ViewShell>
  );
}

/* ====================================================
   Board 看板视图
   ==================================================== */
/* 全局拖拽状态 */
const boardDrag = { taskId: null, fromSection: null };
let boardHandleDown = false; // 只有从把手按下才允许拖拽

/* ============ 单张看板卡片（独立组件） ============ */
function BoardCard({ task, sectionId, onOpenTask }) {
  return (
    <div
      data-task-id={task.id}
      className="board-card"
      draggable
      onDragStart={(e) => {
        if (!boardHandleDown) { e.preventDefault(); return; }
        boardDrag.taskId = task.id;
        boardDrag.fromSection = sectionId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', task.id);
        setTimeout(() => { if (e.target) e.target.style.opacity = '0.4'; }, 0);
      }}
      onDragEnd={(e) => {
        boardHandleDown = false;
        boardDrag.taskId = null;
        if (e.target) e.target.style.opacity = '1';
      }}
      onClick={() => onOpenTask && onOpenTask(task)}
      style={{ position: 'relative', paddingLeft: 22 }}
    >
      <span
        className="board-drag-handle"
        onMouseDown={(e) => { e.stopPropagation(); boardHandleDown = true; }}
        onMouseUp={() => { boardHandleDown = false; }}
        style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', cursor: 'grab', fontSize: 13, lineHeight: 1, color: 'transparent', userSelect: 'none', transition: 'color .12s' }}
      >⠿</span>
      <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: task.labels.length || task.due_date ? 8 : 0, lineHeight: 1.45 }}>{task.title}</div>
      <TaskChips task={task} />
    </div>
  );
}

function BoardView({ projectId, onOpenTask, onSwitchView }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const [newColName, setNewColName] = useState('');
  const proj = DB.project(projectId);
  const sections = DB.sections(projectId);
  const unsectioned = DB.tasks((t) => t.project_id === projectId && !t.section_id && !t.parent_id && !t.completed);

  if (!proj) return <EmptyState icon="board" text="选择一个项目" />;

  return (
    <ViewShell title={proj.name} subtitle="看板视图"
      actions={<button className="btn-ghost" onClick={() => { DB.updateProject(projectId, { view_mode: 'list' }); onSwitchView && onSwitchView('list'); }}><Icon name="list" size={15} /> 切换列表</button>}>
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 16, alignItems: 'flex-start' }}>
        {unsectioned.length > 0 && (
          <BoardCol section={null} tasks={unsectioned} onOpenTask={onOpenTask} projectId={projectId} />
        )}
        {sections.map((s) => {
          const ts = DB.tasks((t) => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed);
          return <BoardCol key={s.id} section={s} tasks={ts} onOpenTask={onOpenTask} projectId={projectId} />;
        })}
        <div style={{ width: 260, flex: 'none' }}>
          <input value={newColName} onChange={(e) => setNewColName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newColName.trim()) { DB.addSection(projectId, newColName.trim()); setNewColName(''); } }}
            placeholder="+ 新建分区"
            style={{ width: '100%', border: '1.5px dashed var(--border)', borderRadius: 10, padding: '8px 12px', fontSize: 13.5, background: 'transparent', color: 'var(--text-secondary)', outline: 'none' }} />
        </div>
      </div>
    </ViewShell>
  );
}

function BoardCol({ section, tasks, onOpenTask, projectId }) {
  const [addingCard, setAddingCard] = useState(false);
  const [dragOver, setDragOver] = useState(false);      // 列高亮
  const [insertBefore, setInsertBefore] = useState(null); // 插入线：taskId | 'end'
  const colRef = useRef(null);

  /* ---- 找鼠标最近的插入位置 ---- */
  const getInsertTarget = useCallback((clientY) => {
    if (!colRef.current) return 'end';
    const cards = [...colRef.current.querySelectorAll('[data-task-id]')];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return card.dataset.taskId;
    }
    return 'end';
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
    setInsertBefore(getInsertTarget(e.clientY));
  };

  const handleDragLeave = (e) => {
    if (!colRef.current?.contains(e.relatedTarget)) {
      setDragOver(false);
      setInsertBefore(null);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    setInsertBefore(null);
    const taskId = boardDrag.taskId;
    if (!taskId) return;

    const newSectionId = section ? section.id : null;

    // 计算新 sort_order
    const tasksInCol = DB.tasks((t) => t.project_id === projectId && t.section_id === newSectionId && !t.parent_id && !t.completed && t.id !== taskId);
    let newOrder;
    if (insertBefore === 'end' || !insertBefore) {
      newOrder = tasksInCol.length > 0 ? Math.max(...tasksInCol.map(t => t.sort_order)) + 1 : 0;
    } else {
      const idx = tasksInCol.findIndex(t => t.id === insertBefore);
      if (idx === 0) newOrder = tasksInCol[0].sort_order - 1;
      else newOrder = idx > 0 ? (tasksInCol[idx - 1].sort_order + tasksInCol[idx].sort_order) / 2 : 0;
    }

    DB.updateTask(taskId, { section_id: newSectionId, sort_order: newOrder });
  };

  const sectionId = section ? section.id : null;

  return (
    <div className="board-col" ref={colRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ transition: 'background .1s' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '2px 0' }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', flex: 1 }}>{section ? section.name : '未分区'}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{tasks.length}</span>
        <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setAddingCard(true)}><Icon name="plus" size={14} /></button>
      </div>

      {/* 列拖入高亮背景 */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 7,
        minHeight: 40, borderRadius: 10, padding: dragOver ? '4px' : '0',
        background: dragOver ? 'var(--bg-hover)' : 'transparent',
        border: dragOver ? '1.5px dashed var(--border)' : '1.5px solid transparent',
        transition: 'all .12s',
      }}>
        {addingCard && (
          <div className="board-card" style={{ padding: 8 }}>
            <QuickComposer projectId={projectId} sectionId={sectionId}
              placeholder="任务名称…" autoFocus onDone={() => setAddingCard(false)} />
          </div>
        )}

        {tasks.map((t) => {
          const showLine = insertBefore === t.id && dragOver;
          return (
            <div key={t.id}>
              {showLine && <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />}
              <BoardCard task={t} sectionId={sectionId} onOpenTask={onOpenTask} />
            </div>
          );
        })}

        {/* 末尾插入线 */}
        {insertBefore === 'end' && dragOver && (
          <div style={{ height: 2, borderRadius: 2, background: 'var(--accent)', margin: '0 4px' }} />
        )}

        {!addingCard && (
          <button className="btn-ghost" style={{ justifyContent: 'flex-start', color: 'var(--text-tertiary)', fontSize: 13 }} onClick={() => setAddingCard(true)}>
            <Icon name="plus" size={13} /> 添加任务
          </button>
        )}
      </div>
    </div>
  );
}

/* ====================================================
   List 项目列表视图
   ==================================================== */
function ListView({ projectId, onOpenTask, onSwitchView }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const [newSec, setNewSec] = useState(false);
  const [newSecName, setNewSecName] = useState('');
  const proj = DB.project(projectId);
  const sections = DB.sections(projectId);
  const unsectioned = DB.tasks((t) => t.project_id === projectId && !t.section_id && !t.parent_id && !t.completed);
  if (!proj) return <EmptyState icon="list" text="选择一个项目" />;
  return (
    <ViewShell title={proj.name} subtitle="列表视图"
      actions={<button className="btn-ghost" onClick={() => { DB.updateProject(projectId, { view_mode: 'board' }); onSwitchView && onSwitchView('board'); }}><Icon name="board" size={15} /> 切换看板</button>}>
      <QuickComposer projectId={projectId} />
      {unsectioned.map((t) => <TaskRow key={t.id} task={t} onClick={onOpenTask} />)}
      {sections.map((s) => {
        const ts = DB.tasks((t) => t.project_id === projectId && t.section_id === s.id && !t.parent_id && !t.completed);
        return (
          <div key={s.id} style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1.5px solid var(--border)', paddingBottom: 5, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)', flex: 1 }}>{s.name}</span>
              <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{ts.length}</span>
              <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => DB.deleteSection(s.id)}><Icon name="trash" size={12} /></button>
            </div>
            {ts.map((t) => <TaskRow key={t.id} task={t} onClick={onOpenTask} />)}
            <QuickComposer projectId={projectId} sectionId={s.id} autoFocus={false} />
          </div>
        );
      })}
      {/* 添加分区 */}
      <div style={{ marginTop: 16 }}>
        {newSec ? (
          <input autoFocus value={newSecName} onChange={(e) => setNewSecName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && newSecName.trim()) { DB.addSection(projectId, newSecName.trim()); setNewSecName(''); setNewSec(false); } if (e.key === 'Escape') { setNewSec(false); setNewSecName(''); } }}
            onBlur={() => { if (newSecName.trim()) { DB.addSection(projectId, newSecName.trim()); } setNewSec(false); setNewSecName(''); }}
            placeholder="分区名称…"
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 12px', fontSize: 13.5, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', width: '100%' }} />
        ) : (
          <button className="btn-ghost" style={{ color: 'var(--text-tertiary)' }} onClick={() => setNewSec(true)}>
            <Icon name="plus" size={14} /> 添加分区
          </button>
        )}
      </div>
    </ViewShell>
  );
}

/* ====================================================
   空状态
   ==================================================== */
function EmptyState({ icon, text, sub }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--text-tertiary)' }}>
      <Icon name={icon} size={40} strokeWidth={1.2} style={{ marginBottom: 12, opacity: .5 }} />
      <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>{text}</div>
      {sub && <div style={{ fontSize: 13 }}>{sub}</div>}
    </div>
  );
}

Object.assign(window, { TaskRow, TaskGroup, ViewShell, InboxView, TodayView, UpcomingView, CalendarView, BoardView, BoardCard, ListView, EmptyState });
