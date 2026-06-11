/* app.jsx — 主应用框架（侧栏 + 路由 + 全局状态） */
const { useState, useEffect, useRef, useCallback } = React;

/* ============ 全局键盘快捷键 ============ */
function useHotkeys(handlers) {
  useEffect(() => {
    const down = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      const key = (e.metaKey || e.ctrlKey ? 'mod+' : '') + (e.shiftKey ? 'shift+' : '') + e.key.toLowerCase();
      if (handlers[key]) { e.preventDefault(); handlers[key](); }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [handlers]);
}

/* ============ 侧栏项目颜色点 ============ */
function ColorDot({ color, size = 9 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' }} />;
}

/* ============ 侧栏 ============ */
function Sidebar({ route, setRoute, collapsed, setCollapsed }) {
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);
  const [addingProject, setAddingProject] = useState(false);
  const [newProjName, setNewProjName] = useState('');
  const newProjRef = useRef(null);
  const projects = DB.projects();
  const todayCount = DB.tasksOnDate(DateU.today()).length + DB.overdueTasks().length;
  const inboxCount = DB.tasksInProject('inbox').length;

  const navItems = [
    { id: 'inbox', label: '收件箱', icon: 'inbox', count: inboxCount },
    { id: 'today', label: '今天', icon: 'today', count: todayCount },
    { id: 'upcoming', label: '即将到来', icon: 'upcoming' },
    { id: 'calendar', label: '日历', icon: 'calendar' },
  ];

  const PROJECT_COLORS = ['#c25e4c','#c98a2e','#5b7fa6','#7a9461','#8a6fa8','#4a7fa8','#c26e3a'];
  const [pickColor, setPickColor] = useState(PROJECT_COLORS[0]);

  const createProject = () => {
    if (!newProjName.trim()) { setAddingProject(false); return; }
    const p = DB.addProject(newProjName.trim(), pickColor);
    setRoute({ view: p.view_mode === 'board' ? 'board' : 'list', projectId: p.id });
    setNewProjName(''); setPickColor(PROJECT_COLORS[0]); setAddingProject(false);
  };

  if (collapsed) {
    return (
      <div style={{ width: 52, background: 'var(--bg-app)', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px 0', gap: 4, flexShrink: 0 }}>
        <button className="btn-icon" onClick={() => setCollapsed(false)} title="展开侧栏"><Icon name="sidebar" size={18} /></button>
        <div style={{ width: 1, height: 12 }} />
        {navItems.map((n) => (
          <button key={n.id} className={'btn-icon' + (route.view === n.id ? ' is-active' : '')}
            style={{ width: 38, height: 38, borderRadius: 9, position: 'relative', color: route.view === n.id ? 'var(--accent-text)' : 'var(--text-secondary)' }}
            title={n.label} onClick={() => setRoute({ view: n.id })}>
            <Icon name={n.icon} size={17} />
            {n.count > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div style={{ width: 220, background: 'var(--bg-app)', borderRight: '1px solid var(--border-soft)', display: 'flex', flexDirection: 'column', flexShrink: 0, overflowY: 'auto' }}>
      {/* 顶部工具栏 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 10px 8px' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', paddingLeft: 4, letterSpacing: -.2 }}>TaskFlow</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button className="btn-icon" title="收起侧栏" onClick={() => setCollapsed(true)}><Icon name="sidebar" size={16} /></button>
        </div>
      </div>

      {/* 导航 */}
      <div style={{ padding: '0 8px', marginBottom: 12 }}>
        {navItems.map((n) => (
          <button key={n.id} className={'side-item' + (route.view === n.id ? ' is-active' : '')} onClick={() => setRoute({ view: n.id })}>
            <Icon name={n.icon} size={16} style={{ flex: 'none' }} />
            {n.label}
            {n.count > 0 && <span className="count">{n.count}</span>}
          </button>
        ))}
      </div>

      {/* 项目列表 */}
      <div style={{ padding: '0 8px', flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '4px 6px 6px', marginBottom: 2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text-tertiary)', letterSpacing: .05, flex: 1 }}>项目</span>
          <button className="btn-icon" style={{ width: 22, height: 22 }} title="新建项目" onClick={() => setAddingProject(true)}><Icon name="plus" size={14} /></button>
        </div>
        {projects.map((p) => {
          const isActive = (route.view === 'board' || route.view === 'list') && route.projectId === p.id;
          const count = DB.tasksInProject(p.id).length;
          return (
            <button key={p.id} className={'side-item' + (isActive ? ' is-active' : '')}
              onClick={() => setRoute({ view: p.view_mode === 'board' ? 'board' : 'list', projectId: p.id })}>
              {p.id === 'inbox' ? <Icon name="inbox" size={15} style={{ flex: 'none' }} /> : <ColorDot color={p.color} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              {count > 0 && <span className="count">{count}</span>}
            </button>
          );
        })}
        {addingProject && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginTop: 6 }}>
            <input autoFocus ref={newProjRef} value={newProjName} onChange={(e) => setNewProjName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') createProject(); if (e.key === 'Escape') { setAddingProject(false); setNewProjName(''); } }}
              placeholder="项目名称"
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 13, background: 'var(--bg-content)', color: 'var(--text-primary)', outline: 'none', marginBottom: 8 }} />
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
              {PROJECT_COLORS.map((c) => (
                <button key={c} onClick={() => setPickColor(c)}
                  style={{ width: 18, height: 18, borderRadius: '50%', background: c, border: pickColor === c ? '2.5px solid var(--text-primary)' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn-primary" style={{ flex: 1, fontSize: 12.5, padding: '5px 0' }} onClick={createProject}>创建</button>
              <button className="btn-outline" style={{ flex: 1, fontSize: 12.5, padding: '5px 0' }} onClick={() => { setAddingProject(false); setNewProjName(''); }}>取消</button>
            </div>
          </div>
        )}
      </div>

      {/* 底部 */}
      <div style={{ padding: '10px 8px', borderTop: '1px solid var(--border-soft)', display: 'flex', gap: 2, marginTop: 12 }}>
        <button className="btn-ghost" style={{ flex: 1, justifyContent: 'flex-start', fontSize: 12.5 }}
          onClick={() => { const data = DB.exportJSON(); const a = document.createElement('a'); a.href = 'data:application/json,' + encodeURIComponent(data); a.download = 'taskflow-export.json'; a.click(); }}>
          <Icon name="archive" size={14} /> 导出数据
        </button>
      </div>
    </div>
  );
}

/* ============ 搜索覆盖层 ============ */
function SearchOverlay({ onClose, onOpenTask }) {
  const [q, setQ] = useState('');
  const results = q.length > 1 ? DB.tasks((t) => t.title.toLowerCase().includes(q.toLowerCase()) || (t.description || '').toLowerCase().includes(q.toLowerCase())).slice(0, 12) : [];
  return (
    <div className="modal-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ alignItems: 'flex-start', paddingTop: '12vh' }}>
      <div className="modal-card" style={{ width: 'min(580px, 92vw)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--border-soft)' }}>
          <Icon name="search" size={18} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter' && results[0]) { onOpenTask(results[0]); onClose(); } }}
            placeholder="搜索任务…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'none', fontSize: 16, color: 'var(--text-primary)' }} />
          <kbd style={{ fontSize: 12, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', padding: '2px 7px', borderRadius: 5 }}>Esc</kbd>
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', padding: q ? '6px' : '0' }}>
          {q.length > 1 && results.length === 0 && <div style={{ padding: '20px 16px', color: 'var(--text-tertiary)', fontSize: 13.5, textAlign: 'center' }}>没有找到「{q}」</div>}
          {results.map((t) => {
            const proj = DB.project(t.project_id);
            return (
              <button key={t.id} className="menu-item" style={{ borderRadius: 8 }}
                onClick={() => { onOpenTask(t); onClose(); }}>
                <TaskCheckbox task={t} />
                <span style={{ flex: 1, fontSize: 13.5, color: t.completed ? 'var(--text-tertiary)' : 'var(--text-primary)', textDecoration: t.completed ? 'line-through' : 'none' }}>{t.title}</span>
                {proj && <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{proj.name}</span>}
                {t.due_date && <span style={{ fontSize: 12, color: DateU.isOverdue(t.due_date) ? 'var(--p1)' : 'var(--text-tertiary)' }}>{DateU.human(t.due_date)}</span>}
              </button>
            );
          })}
        </div>
        {!q && (
          <div style={{ padding: '16px', fontSize: 12.5, color: 'var(--text-tertiary)', textAlign: 'center' }}>输入关键词搜索任务</div>
        )}
      </div>
    </div>
  );
}

/* ============ 主 App ============ */
function App() {
  const [theme, setTheme] = useState(() => DB.getSetting('theme') || 'light');
  const [route, setRoute] = useState({ view: 'today' });
  const [collapsed, setCollapsed] = useState(false);
  const [taskModal, setTaskModal] = useState(null);  // taskId or null
  const [aiOpen, setAiOpen] = useState(false);
  const [aiProjectId, setAiProjectId] = useState(null);
  const [aiRefTask, setAiRefTask] = useState(null);
  const [showSearch, setShowSearch] = useState(false);
  const [aiLayout, setAiLayout] = useState('float'); // float | sidebar | bottom
  const [, tick] = useState(0);
  useEffect(() => DB.subscribe(() => tick((n) => n + 1)), []);

  // 同步主题
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    DB.setSetting('theme', theme);
  }, [theme]);

  // 全局 hooks（供子组件使用）
  window.__openTaskModal = (id) => setTaskModal(id);
  window.__openAI = (projId, task) => { setAiProjectId(projId || 'inbox'); setAiRefTask(task || null); setAiOpen(true); };

  useHotkeys({
    'mod+k': () => setShowSearch(true),
    'mod+/': () => setAiOpen((o) => !o),
    't': () => setRoute({ view: 'today' }),
    'i': () => setRoute({ view: 'inbox' }),
    'u': () => setRoute({ view: 'upcoming' }),
    'c': () => setRoute({ view: 'calendar' }),
  });

  const openTask = (task) => setTaskModal(task.id);
  const curProjectId = route.projectId || 'inbox';

  // AI 布局：sidebar 时主内容要留出空间
  const aiInline = aiOpen && aiLayout === 'sidebar';

  return (
    <div data-theme={theme} style={{ display: 'flex', height: '100vh', background: 'var(--bg-content)' }}>
      <Sidebar route={route} setRoute={setRoute} collapsed={collapsed} setCollapsed={setCollapsed} />

      {/* 主内容区 */}
      <div style={{ flex: 1, display: 'flex', minWidth: 0, flexDirection: 'column' }}>
        {/* 顶部工具栏 */}
        <div style={{ height: 46, display: 'flex', alignItems: 'center', gap: 6, padding: '0 18px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-content)', flexShrink: 0 }}>
          <button className="btn-ghost" style={{ fontSize: 13 }} onClick={() => setShowSearch(true)}>
            <Icon name="search" size={15} /> 搜索
            <kbd style={{ fontSize: 11, color: 'var(--text-tertiary)', background: 'var(--bg-inset)', padding: '1px 5px', borderRadius: 4, marginLeft: 6 }}>⌘K</kbd>
          </button>
          <span style={{ flex: 1 }} />
          {/* AI 布局切换 */}
          {aiOpen && (
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-inset)', borderRadius: 8, padding: 3 }}>
              {[['float', '浮动'], ['sidebar', '侧栏'], ['bottom', '底栏']].map(([l, n]) => (
                <button key={l} onClick={() => setAiLayout(l)}
                  style={{ fontSize: 11.5, padding: '3px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: aiLayout === l ? 'var(--bg-card)' : 'transparent', color: aiLayout === l ? 'var(--text-primary)' : 'var(--text-tertiary)', fontFamily: 'var(--font)' }}>{n}</button>
              ))}
            </div>
          )}
          <button className="btn-ghost" style={{ fontSize: 13 }} title="切换主题" onClick={() => setTheme((t) => t === 'light' ? 'dark' : 'light')}>
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={15} />
          </button>
        </div>

        {/* 内容 + 可选侧边 AI */}
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', background: 'var(--bg-content)' }}>
            {route.view === 'inbox' && <InboxView onOpenTask={openTask} />}
            {route.view === 'today' && <TodayView onOpenTask={openTask} />}
            {route.view === 'upcoming' && <UpcomingView onOpenTask={openTask} />}
            {route.view === 'calendar' && <CalendarView onOpenTask={openTask} />}
            {route.view === 'board' && <BoardView projectId={curProjectId} onOpenTask={openTask} onSwitchView={(v) => setRoute({ view: v, projectId: curProjectId })} />}
            {route.view === 'list' && <ListView projectId={curProjectId} onOpenTask={openTask} onSwitchView={(v) => setRoute({ view: v, projectId: curProjectId })} />}
          </div>
          {aiInline && (
            <AIPanel layout="sidebar" projectId={aiProjectId} refTask={aiRefTask} onClose={() => setAiOpen(false)} />
          )}
        </div>
      </div>

      {/* AI FAB */}
      {!aiOpen && (
        <button className="ai-fab" title="AI 助手 (⌘/)" onClick={() => window.__openAI(curProjectId)}>
          <Icon name="sparkle" size={22} />
        </button>
      )}

      {/* AI 面板（float / bottom） */}
      {aiOpen && aiLayout !== 'sidebar' && (
        <AIPanel layout={aiLayout} projectId={aiProjectId} refTask={aiRefTask} onClose={() => setAiOpen(false)} />
      )}

      {/* 任务详情 Modal */}
      {taskModal && <TaskModal taskId={taskModal} onClose={() => setTaskModal(null)} />}

      {/* 搜索 */}
      {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} onOpenTask={openTask} />}
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
