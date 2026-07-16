import Database from 'better-sqlite3'
import { v4 as uid } from 'uuid'

const now = () => new Date().toISOString()
const todayStr = (offset = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

const uidGen = (prefix: string) => prefix + '_' + uid().slice(0, 16)

export function seedIfEmpty(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as c FROM projects').get() as { c: number }
  if (count.c > 0) return

  const t = now()

  const pInbox = 'inbox'
  const pPaper = uidGen('prj')
  const pVLA = uidGen('prj')
  const pLife = uidGen('prj')

  const sP1 = uidGen('sec'); const sP2 = uidGen('sec'); const sP3 = uidGen('sec')
  const sV1 = uidGen('sec'); const sV2 = uidGen('sec')

  const lUrgent = uidGen('lbl'); const lRead = uidGen('lbl'); const lDeep = uidGen('lbl')

  const insertProject = db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?,?)')
  const insertSection = db.prepare('INSERT INTO sections VALUES (?,?,?,?)')
  const insertLabel = db.prepare('INSERT INTO labels VALUES (?,?,?)')
  const insertTask = db.prepare('INSERT INTO tasks (id,project_id,section_id,parent_id,title,description,due_date,due_time,repeat,priority,labels,reminder,completed,completed_at,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const insertSetting = db.prepare('INSERT INTO settings VALUES (?,?)')

  const tx = db.transaction(() => {
    insertProject.run(pInbox, '收件箱', '#8a8a85', 'list', 0, 0, 0, t)
    insertProject.run(pPaper, '论文写作', '#c25e4c', 'board', 1, 1, 0, t)
    insertProject.run(pVLA, 'VLA 研究', '#5b7fa6', 'board', 1, 2, 0, t)
    insertProject.run(pLife, '生活', '#7a9461', 'list', 0, 3, 0, t)

    insertSection.run(sP1, pPaper, '资料收集', 0)
    insertSection.run(sP2, pPaper, '写作中', 1)
    insertSection.run(sP3, pPaper, '待修改', 2)
    insertSection.run(sV1, pVLA, '实验', 0)
    insertSection.run(sV2, pVLA, '阅读列表', 1)

    insertLabel.run(lUrgent, '紧急', '#c25e4c')
    insertLabel.run(lRead, '阅读', '#5b7fa6')
    insertLabel.run(lDeep, '深度工作', '#8a6fa8')

    const addTask = (overrides: Record<string, unknown>) => {
      const defaults = {
        id: uidGen('tsk'), project_id: pInbox, section_id: null, parent_id: null,
        title: '', description: '', due_date: null, due_time: null,
        repeat: null, priority: 4, labels: '[]', reminder: null,
        completed: 0, completed_at: null, sort_order: 0,
        created_at: t, updated_at: t,
      }
      const task = { ...defaults, ...overrides }
      insertTask.run(task.id, task.project_id, task.section_id, task.parent_id,
        task.title, task.description, task.due_date, task.due_time,
        task.repeat, task.priority, task.labels, task.reminder,
        task.completed, task.completed_at, task.sort_order,
        task.created_at, task.updated_at)
    }

    addTask({ title: '整理本周会议纪要', due_date: todayStr(), priority: 3, sort_order: 0 })
    addTask({ title: '回复审稿意见邮件', due_date: todayStr(), due_time: '16:00', priority: 2, labels: JSON.stringify([lUrgent]), sort_order: 1 })
    addTask({ project_id: pPaper, section_id: sP1, title: '收集 RLHF 相关综述', priority: 3, labels: JSON.stringify([lRead]), due_date: todayStr(1), sort_order: 0 })
    addTask({ project_id: pPaper, section_id: sP2, title: '完成方法论章节初稿', description: '重点写清楚数据收集 pipeline', priority: 1, labels: JSON.stringify([lDeep]), due_date: todayStr(2), sort_order: 0 })
    addTask({ project_id: pPaper, section_id: sP2, title: '绘制系统架构图', priority: 3, due_date: todayStr(4), sort_order: 1 })
    addTask({ project_id: pPaper, section_id: sP3, title: '修改摘要措辞', priority: 4, sort_order: 0 })
    addTask({ project_id: pVLA, section_id: sV1, title: '复现 OpenVLA 基线', description: '先在仿真环境跑通', priority: 2, due_date: todayStr(3), sort_order: 0 })
    addTask({ project_id: pVLA, section_id: sV1, title: '设计消融实验方案', priority: 2, due_date: todayStr(7), labels: JSON.stringify([lDeep]), sort_order: 1 })
    addTask({ project_id: pVLA, section_id: sV2, title: '读 RT-2 论文', priority: 3, labels: JSON.stringify([lRead]), sort_order: 0 })
    addTask({ project_id: pLife, title: '预约牙医复诊', due_date: todayStr(5), due_time: '10:00', priority: 3, sort_order: 0 })
    addTask({ project_id: pLife, title: '每周买菜', due_date: todayStr(2), repeat: 'weekly', priority: 4, sort_order: 1 })
    addTask({ title: '已完成的示例任务', completed: 1, completed_at: t, sort_order: 9 })

    insertSetting.run('theme', 'light')
  })

  tx()
  console.log('Database seeded with demo data.')
}
