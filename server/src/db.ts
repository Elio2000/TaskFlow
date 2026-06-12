import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'todo.sqlite3')

export function initDB(): Database.Database {
  const db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8a8a85',
      view_mode TEXT NOT NULL DEFAULT 'list',
      favorite INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS labels (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#8a8a85'
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL DEFAULT 'inbox',
      section_id TEXT,
      parent_id TEXT,
      title TEXT NOT NULL DEFAULT '',
      description TEXT DEFAULT '',
      start_date TEXT,
      due_date TEXT,
      due_time TEXT,
      end_time TEXT,
      repeat TEXT,
      priority INTEGER NOT NULL DEFAULT 4,
      labels TEXT NOT NULL DEFAULT '[]',
      reminder TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      completed_at TEXT,
      sort_order REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE SET NULL,
      FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 'New Conversation',
      summary TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      refs TEXT DEFAULT '[]',
      proposals TEXT,
      proposals_applied INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'ai',
      created_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agents_docs (
      project_id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS task_activities (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      field TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cycle_tasks (
      cycle_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (cycle_id, task_id),
      FOREIGN KEY (cycle_id) REFERENCES cycles(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
  `)

  // Repair bad labels data
  function repairLabels(value: string): string {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return JSON.stringify(parsed.filter((v: any) => typeof v === 'string'))
      if (typeof parsed === 'string') {
        const parsed2 = JSON.parse(parsed)
        if (Array.isArray(parsed2)) return JSON.stringify(parsed2.filter((v: any) => typeof v === 'string'))
      }
    } catch {}
    return '[]'
  }

  const tasks = db.prepare('SELECT id, labels FROM tasks').all() as any[]
  const updateStmt = db.prepare('UPDATE tasks SET labels = ? WHERE id = ?')
  for (const t of tasks) {
    const fixed = repairLabels(t.labels)
    if (fixed !== t.labels) {
      updateStmt.run(fixed, t.id)
    }
  }

  // Clean up empty assistant messages
  db.prepare("DELETE FROM messages WHERE role = 'assistant' AND trim(content) = '' AND proposals IS NULL").run()

  return db
}
