import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDB } from './db.js'
import { seedIfEmpty } from './seed.js'
import { taskRoutes } from './routes/tasks.js'
import { projectRoutes } from './routes/projects.js'
import { labelRoutes } from './routes/labels.js'
import { sectionRoutes } from './routes/sections.js'
import { chatRoutes } from './routes/chat.js'
import { memoriesRoutes } from './routes/memories.js'
import { agentsDocRoutes } from './routes/agentsDoc.js'
import { settingsRoutes } from './routes/settings.js'
import { aiRoutes } from './routes/ai.js'

declare global {
  namespace Express {
    interface Request {
      db: Database.Database
    }
  }
}

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

// Initialize database
const db = initDB()
seedIfEmpty(db)

// Middleware: attach db to every request
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.db = db
  next()
})

// Routes
app.use('/api/tasks', taskRoutes())
app.use('/api/projects', projectRoutes())
app.use('/api/labels', labelRoutes())
app.use('/api/sections', sectionRoutes())
app.use('/api/chat', chatRoutes())
app.use('/api/chat', aiRoutes())       // POST /api/chat/stream (native DeepSeek)
app.use('/api/memories', memoriesRoutes())
app.use('/api/agents-doc', agentsDocRoutes())
app.use('/api/settings', settingsRoutes())

// Serve static files in production
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.join(__dirname, '../../client/dist')))

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
