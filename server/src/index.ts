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
import { settingsRoutes } from './routes/settings.js'
import { planRoutes } from './routes/plan.js'
import { cycleRoutes } from './routes/cycles.js'

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
app.use('/api/settings', settingsRoutes())
app.use('/api/plan', planRoutes())     // POST /api/plan（一次性规划核心，网页 + MCP 共用）
app.use('/api/cycles', cycleRoutes())

// Serve static files in production
const __dirname = path.dirname(fileURLToPath(import.meta.url))
app.use(express.static(path.join(__dirname, '../../client/dist')))

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[ERROR] Port ${PORT} is already in use.`)
    console.error(`Run: kill $(lsof -ti:${PORT})  then try again.\n`)
    process.exit(1)
  } else {
    throw err
  }
})
