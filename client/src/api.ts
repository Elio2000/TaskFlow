const BASE = '/api'

async function request<T = any>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${res.statusText}`)
  return res.json()
}

// Types
export interface Project {
  id: string; name: string; color: string; view_mode: string;
  favorite: number; sort_order: number; archived: number; created_at: string;
}

export interface Section {
  id: string; project_id: string; name: string; sort_order: number;
}

export interface Label {
  id: string; name: string; color: string;
}

export interface Task {
  id: string; project_id: string; section_id: string | null; parent_id: string | null;
  title: string; description: string;
  start_date: string | null; due_date: string | null; due_time: string | null; end_time: string | null;
  repeat: string | null; priority: number; labels: string; reminder: string | null;
  completed: number; completed_at: string | null;
  sort_order: number; created_at: string; updated_at: string;
}

export interface Conversation {
  id: string; project_id: string; title: string; summary: string | null;
  created_at: string; updated_at: string;
}

export interface Message {
  id: string; conversation_id: string; role: string; content: string;
  refs: string; proposals: string | null; proposals_applied: number; created_at: string;
}

export interface Memory {
  id: string; project_id: string; content: string; source: string; created_at: string;
}

// Projects
export const api = {
  getProjects: () => request<Project[]>('/projects'),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  addProject: (name: string, color?: string) => request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateProject: (id: string, patch: Partial<Project>) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteProject: (id: string) => request(`/projects/${id}`, { method: 'DELETE' }),

  // Sections
  getSections: (projectId: string) => request<Section[]>(`/sections?project_id=${projectId}`),
  addSection: (projectId: string, name: string) => request<Section>('/sections', { method: 'POST', body: JSON.stringify({ project_id: projectId, name }) }),
  updateSection: (id: string, patch: Partial<Section>) => request<Section>(`/sections/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteSection: (id: string) => request(`/sections/${id}`, { method: 'DELETE' }),

  // Labels
  getLabels: () => request<Label[]>('/labels'),
  addLabel: (name: string, color?: string) => request<Label>('/labels', { method: 'POST', body: JSON.stringify({ name, color }) }),

  // Tasks
  getTasks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : ''
    return request<Task[]>(`/tasks${qs}`)
  },
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  getTaskActivities: (taskId: string) => request<any[]>(`/tasks/${taskId}/activities`),
  addTask: (fields: Partial<Task>) => request<Task>('/tasks', { method: 'POST', body: JSON.stringify(fields) }),
  updateTask: (id: string, patch: Partial<Task>) => request<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteTask: (id: string) => request(`/tasks/${id}`, { method: 'DELETE' }),
  toggleTask: (id: string) => request<Task>(`/tasks/${id}/toggle`, { method: 'PATCH' }),
  bulkUpdate: (ids: string[], updates: Partial<Task>) =>
    request('/tasks/bulk', { method: 'POST', body: JSON.stringify({ ids, updates }) }),

  // Conversations
  getConversations: (projectId: string) => request<Conversation[]>(`/chat/conversations?project_id=${projectId}`),
  addConversation: (projectId: string, title?: string) => request<Conversation>('/chat/conversations', { method: 'POST', body: JSON.stringify({ project_id: projectId, title }) }),
  getMessages: (convId: string) => request<Message[]>(`/chat/conversations/${convId}/messages`),
  addMessage: (convId: string, role: string, content: string, extra?: Record<string, any>) =>
    request<Message>(`/chat/conversations/${convId}/messages`, { method: 'POST', body: JSON.stringify({ role, content, ...extra }) }),
  clearMessages: (convId: string) => request(`/chat/conversations/${convId}/clear`, { method: 'POST' }),
  updateMessage: (msgId: string, patch: Record<string, any>) => request<Message>(`/chat/messages/${msgId}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // Memories
  getMemories: (projectId: string) => request<Memory[]>(`/memories?project_id=${projectId}`),
  addMemory: (projectId: string, content: string, source?: string) => request<Memory>('/memories', { method: 'POST', body: JSON.stringify({ project_id: projectId, content, source }) }),
  deleteMemory: (id: string) => request(`/memories/${id}`, { method: 'DELETE' }),

  // Agents Doc
  getAgentsDoc: (projectId: string) => request<{ content: string; updated_at: string | null }>(`/agents-doc/${projectId}`),
  setAgentsDoc: (projectId: string, content: string) => request(`/agents-doc/${projectId}`, { method: 'PUT', body: JSON.stringify({ content }) }),

  // Settings
  getSetting: (key: string) => request<{ key: string; value: string | null }>(`/settings/${key}`),
  setSetting: (key: string, value: string) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),

  // Cycles
  getCycles: () => request<any[]>('/cycles'),
  addCycle: (name: string, start_date: string, end_date: string) => request('/cycles', { method: 'POST', body: JSON.stringify({ name, start_date, end_date }) }),
  deleteCycle: (id: string) => request(`/cycles/${id}`, { method: 'DELETE' }),
  getCycleTasks: (cycleId: string) => request<Task[]>(`/cycles/${cycleId}/tasks`),
  addTaskToCycle: (cycleId: string, taskId: string) => request(`/cycles/${cycleId}/tasks`, { method: 'POST', body: JSON.stringify({ task_id: taskId }) }),
  removeTaskFromCycle: (cycleId: string, taskId: string) => request(`/cycles/${cycleId}/tasks/${taskId}`, { method: 'DELETE' }),
}
