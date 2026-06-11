/* ============================================================
   db.js — 统一本地数据库层
   设计为 SQLite 风格的表结构，便于以后迁移到桌面应用：
   每个 "表" 是一个对象数组，行内字段是扁平的标量/JSON 列。
   表：projects / sections / tasks / labels / conversations /
       messages / memories / agents_docs / settings
   持久化：localStorage 单 key（"aitodo.db.v1"），写入防抖。
   订阅：DB.subscribe(fn) — 任何写操作后通知，React 端用它刷新。
   ============================================================ */
(function () {
  const STORAGE_KEY = 'aitodo.db.v1';

  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const now = () => new Date().toISOString();
  const todayStr = (offset = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  /* ---------- 种子数据 ---------- */
  function seed() {
    const t = now();
    const pInbox = 'inbox';
    const pPaper = uid('prj');
    const pVLA = uid('prj');
    const pLife = uid('prj');
    const sP1 = uid('sec'), sP2 = uid('sec'), sP3 = uid('sec');
    const sV1 = uid('sec'), sV2 = uid('sec');
    const lUrgent = uid('lbl'), lRead = uid('lbl'), lDeep = uid('lbl');

    const task = (o) => Object.assign({
      id: uid('tsk'), project_id: pInbox, section_id: null, parent_id: null,
      title: '', description: '', due_date: null, due_time: null,
      repeat: null, priority: 4, labels: [], reminder: null,
      completed: 0, completed_at: null, sort_order: 0,
      created_at: t, updated_at: t,
    }, o);

    return {
      meta: { version: 1, created_at: t },
      projects: [
        { id: pInbox, name: '收件箱', color: '#8a8a85', view_mode: 'list', favorite: 0, sort_order: 0, archived: 0, created_at: t },
        { id: pPaper, name: '论文写作', color: '#c25e4c', view_mode: 'board', favorite: 1, sort_order: 1, archived: 0, created_at: t },
        { id: pVLA, name: 'VLA 研究', color: '#5b7fa6', view_mode: 'board', favorite: 1, sort_order: 2, archived: 0, created_at: t },
        { id: pLife, name: '生活', color: '#7a9461', view_mode: 'list', favorite: 0, sort_order: 3, archived: 0, created_at: t },
      ],
      sections: [
        { id: sP1, project_id: pPaper, name: '资料收集', sort_order: 0 },
        { id: sP2, project_id: pPaper, name: '写作中', sort_order: 1 },
        { id: sP3, project_id: pPaper, name: '待修改', sort_order: 2 },
        { id: sV1, project_id: pVLA, name: '实验', sort_order: 0 },
        { id: sV2, project_id: pVLA, name: '阅读列表', sort_order: 1 },
      ],
      labels: [
        { id: lUrgent, name: '紧急', color: '#c25e4c' },
        { id: lRead, name: '阅读', color: '#5b7fa6' },
        { id: lDeep, name: '深度工作', color: '#8a6fa8' },
      ],
      tasks: [
        task({ title: '整理本周会议纪要', due_date: todayStr(), priority: 3, sort_order: 0 }),
        task({ title: '回复审稿意见邮件', due_date: todayStr(), due_time: '16:00', priority: 2, labels: [lUrgent], sort_order: 1 }),
        task({ project_id: pPaper, section_id: sP1, title: '收集 RLHF 相关综述', priority: 3, labels: [lRead], due_date: todayStr(1), sort_order: 0 }),
        task({ project_id: pPaper, section_id: sP2, title: '完成方法论章节初稿', description: '重点写清楚数据收集 pipeline', priority: 1, labels: [lDeep], due_date: todayStr(2), sort_order: 0 }),
        task({ project_id: pPaper, section_id: sP2, title: '绘制系统架构图', priority: 3, due_date: todayStr(4), sort_order: 1 }),
        task({ project_id: pPaper, section_id: sP3, title: '修改摘要措辞', priority: 4, sort_order: 0 }),
        task({ project_id: pVLA, section_id: sV1, title: '复现 OpenVLA 基线', description: '先在仿真环境跑通', priority: 2, due_date: todayStr(3), sort_order: 0 }),
        task({ project_id: pVLA, section_id: sV1, title: '设计消融实验方案', priority: 2, due_date: todayStr(7), labels: [lDeep], sort_order: 1 }),
        task({ project_id: pVLA, section_id: sV2, title: '读 RT-2 论文', priority: 3, labels: [lRead], sort_order: 0 }),
        task({ project_id: pLife, title: '预约牙医复诊', due_date: todayStr(5), due_time: '10:00', priority: 3, sort_order: 0 }),
        task({ project_id: pLife, title: '每周买菜', due_date: todayStr(2), repeat: 'weekly', priority: 4, sort_order: 1 }),
        task({ title: '已完成的示例任务', completed: 1, completed_at: t, sort_order: 9 }),
      ],
      conversations: [],
      messages: [],
      memories: [
        { id: uid('mem'), project_id: pPaper, content: '论文目标投 CoRL 2026，截稿日期大约在 9 月中旬。', source: 'user', created_at: t },
        { id: uid('mem'), project_id: pVLA, content: '实验集群只有周二/周四晚上空闲，大型训练任务要排在那时候。', source: 'user', created_at: t },
      ],
      agents_docs: [
        { project_id: pPaper, content: '# AGENTS.md — 论文写作\n\n## 项目概况\n正在写一篇关于 VLA 模型数据收集方法的论文，目标会议 CoRL 2026。\n\n## 当前阶段\n方法论章节写作中，实验部分等 VLA 研究项目的结果。\n\n## 协作约定\n- 任务分解时颗粒度控制在半天以内\n- 写作类任务默认标「深度工作」标签\n', updated_at: t },
        { project_id: pVLA, content: '# AGENTS.md — VLA 研究\n\n## 项目概况\n探索视觉-语言-动作模型的数据高效训练方法。\n\n## 关键约束\n- 集群仅周二/周四晚可用\n- 基线：OpenVLA、RT-2\n', updated_at: t },
      ],
      settings: { theme: 'light' },
    };
  }

  /* ---------- 加载 / 保存 ---------- */
  let data;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    data = raw ? JSON.parse(raw) : seed();
  } catch (e) { data = seed(); }

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (e) { /* quota */ }
    }, 120);
  }

  const listeners = new Set();
  function notify() { persist(); listeners.forEach((fn) => fn()); }

  /* ---------- 通用工具 ---------- */
  function table(name) { return data[name]; }
  function find(name, id) { return data[name].find((r) => r.id === id) || null; }
  function update(name, id, patch) {
    const row = find(name, id);
    if (!row) return null;
    Object.assign(row, patch, { updated_at: now() });
    notify();
    return row;
  }
  function remove(name, id) {
    const i = data[name].findIndex((r) => r.id === id);
    if (i >= 0) { data[name].splice(i, 1); notify(); }
  }

  /* ---------- API ---------- */
  const DB = {
    uid, now, todayStr,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    raw() { return data; },
    exportJSON() { return JSON.stringify(data, null, 2); },
    resetToSeed() { data = seed(); notify(); },

    /* settings */
    getSetting(k) { return data.settings[k]; },
    setSetting(k, v) { data.settings[k] = v; notify(); },

    /* projects */
    projects() { return data.projects.filter((p) => !p.archived).sort((a, b) => a.sort_order - b.sort_order); },
    project(id) { return find('projects', id); },
    addProject(name, color) {
      const p = { id: uid('prj'), name, color: color || '#8a8a85', view_mode: 'list', favorite: 0, sort_order: data.projects.length, archived: 0, created_at: now() };
      data.projects.push(p); notify(); return p;
    },
    updateProject(id, patch) { return update('projects', id, patch); },
    deleteProject(id) {
      if (id === 'inbox') return;
      data.tasks = data.tasks.filter((t) => t.project_id !== id);
      data.sections = data.sections.filter((s) => s.project_id !== id);
      data.memories = data.memories.filter((m) => m.project_id !== id);
      data.agents_docs = data.agents_docs.filter((d) => d.project_id !== id);
      remove('projects', id);
    },

    /* sections */
    sections(projectId) { return data.sections.filter((s) => s.project_id === projectId).sort((a, b) => a.sort_order - b.sort_order); },
    section(id) { return find('sections', id); },
    addSection(projectId, name) {
      const s = { id: uid('sec'), project_id: projectId, name, sort_order: this.sections(projectId).length };
      data.sections.push(s); notify(); return s;
    },
    updateSection(id, patch) { return update('sections', id, patch); },
    deleteSection(id) {
      data.tasks.forEach((t) => { if (t.section_id === id) t.section_id = null; });
      remove('sections', id);
    },

    /* labels */
    labels() { return data.labels; },
    label(id) { return find('labels', id); },
    addLabel(name, color) {
      const l = { id: uid('lbl'), name, color: color || '#8a8a85' };
      data.labels.push(l); notify(); return l;
    },

    /* tasks */
    task(id) { return find('tasks', id); },
    tasks(filter) {
      let rows = data.tasks;
      if (filter) rows = rows.filter(filter);
      return rows.slice().sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));
    },
    tasksInProject(projectId, includeDone) {
      return this.tasks((t) => t.project_id === projectId && !t.parent_id && (includeDone || !t.completed));
    },
    subtasks(parentId) { return this.tasks((t) => t.parent_id === parentId); },
    tasksOnDate(dateStr, includeDone) {
      return this.tasks((t) => t.due_date === dateStr && !t.parent_id && (includeDone || !t.completed));
    },
    overdueTasks() {
      const today = todayStr();
      return this.tasks((t) => !t.completed && !t.parent_id && t.due_date && t.due_date < today);
    },
    addTask(fields) {
      const t = Object.assign({
        id: uid('tsk'), project_id: 'inbox', section_id: null, parent_id: null,
        title: '', description: '', start_date: null, due_date: null, due_time: null, end_time: null,
        repeat: null, priority: 4, labels: [], reminder: null,
        completed: 0, completed_at: null,
        sort_order: 1e6, created_at: now(), updated_at: now(),
      }, fields);
      data.tasks.push(t); notify(); return t;
    },
    updateTask(id, patch) { return update('tasks', id, patch); },
    deleteTask(id) {
      data.tasks = data.tasks.filter((t) => t.id !== id && t.parent_id !== id);
      notify();
    },
    toggleTask(id) {
      const t = find('tasks', id);
      if (!t) return;
      if (!t.completed && t.repeat && t.due_date) {
        // 重复任务：完成后滚动到下一次
        const d = new Date(t.due_date + 'T00:00:00');
        if (t.repeat === 'daily') d.setDate(d.getDate() + 1);
        else if (t.repeat === 'weekly') d.setDate(d.getDate() + 7);
        else if (t.repeat === 'monthly') d.setMonth(d.getMonth() + 1);
        t.due_date = d.toISOString().slice(0, 10);
        t.updated_at = now();
        notify(); return;
      }
      t.completed = t.completed ? 0 : 1;
      t.completed_at = t.completed ? now() : null;
      t.updated_at = now();
      notify();
    },

    /* conversations & messages（每个项目独立的对话历史） */
    conversations(projectId) {
      return data.conversations.filter((c) => c.project_id === projectId).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    conversation(id) { return find('conversations', id); },
    addConversation(projectId, title) {
      const c = { id: uid('cnv'), project_id: projectId, title: title || '新对话', summary: null, created_at: now(), updated_at: now() };
      data.conversations.push(c); notify(); return c;
    },
    updateConversation(id, patch) { return update('conversations', id, patch); },
    deleteConversation(id) {
      data.messages = data.messages.filter((m) => m.conversation_id !== id);
      remove('conversations', id);
    },
    messages(conversationId) {
      return data.messages.filter((m) => m.conversation_id === conversationId).sort((a, b) => a.created_at.localeCompare(b.created_at));
    },
    addMessage(conversationId, role, content, extra) {
      const m = Object.assign({ id: uid('msg'), conversation_id: conversationId, role, content, refs: [], proposals: null, created_at: now() }, extra || {});
      data.messages.push(m);
      const c = find('conversations', conversationId);
      if (c) c.updated_at = now();
      notify(); return m;
    },
    updateMessage(id, patch) { return update('messages', id, patch); },
    clearMessages(conversationId, keepIds) {
      data.messages = data.messages.filter((m) => m.conversation_id !== conversationId || (keepIds && keepIds.includes(m.id)));
      notify();
    },

    /* memories（每个项目独立 memory） */
    memories(projectId) { return data.memories.filter((m) => m.project_id === projectId).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
    addMemory(projectId, content, source) {
      const m = { id: uid('mem'), project_id: projectId, content, source: source || 'ai', created_at: now() };
      data.memories.push(m); notify(); return m;
    },
    deleteMemory(id) { remove('memories', id); },

    /* AGENTS.md */
    agentsDoc(projectId) {
      const d = data.agents_docs.find((x) => x.project_id === projectId);
      return d ? d.content : '';
    },
    setAgentsDoc(projectId, content) {
      let d = data.agents_docs.find((x) => x.project_id === projectId);
      if (d) { d.content = content; d.updated_at = now(); }
      else data.agents_docs.push({ project_id: projectId, content, updated_at: now() });
      notify();
    },
  };

  window.DB = DB;
})();
