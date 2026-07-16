import { Router, Request, Response } from 'express'
import { planTasks } from '../plan.js'

/* POST /api/plan — 一次性规划的 REST 出口（网页 PlannerBox 与 MCP plan_tasks 共用）。

   Key 解析规则（对「BYOK-only 无服务端兜底」原则的有意修订，见 CLAUDE.md/README）：
   1) 请求体 apiKey —— 网页端仍是纯 BYOK，key 只存浏览器 localStorage、逐请求携带；
   2) 环境变量 TASKFLOW_AI_KEY —— 给无浏览器的 MCP/headless 调用方的显式 opt-in 回退；
   3) 两者皆无 → 400 + 清晰中文提示。
   校验成功与否都返回 200 + 判别联合 { type: proposals|questions|error, meta }；
   400 只用于入参/Key 缺失。 */
export function planRoutes(): Router {
  const router = Router()

  router.post('/', async (req: Request, res: Response) => {
    const body = req.body ?? {}
    const { brain_dump, answers, project_id, apiKey, baseUrl, model } = body

    if (typeof brain_dump !== 'string' || !brain_dump.trim()) {
      return res.status(400).json({ error: 'brain_dump 不能为空：请把要规划的想法/目标写进 brain_dump。' })
    }
    if (answers !== undefined && !(Array.isArray(answers) && answers.every((a: unknown) => typeof a === 'string'))) {
      return res.status(400).json({ error: 'answers 必须是字符串数组（每项一条对澄清问题的回答）。' })
    }

    const key = (typeof apiKey === 'string' && apiKey.trim()) ? apiKey.trim() : (process.env.TASKFLOW_AI_KEY || '').trim()
    if (!key) {
      return res.status(400).json({
        error: '缺少 AI Key：网页端请在「AI 设置」中填写你自己的 API Key（BYOK，只存浏览器本地）；MCP / 无界面调用请在 TaskFlow 服务端设置环境变量 TASKFLOW_AI_KEY（显式 opt-in）。',
      })
    }

    const result = await planTasks(req.db, {
      brain_dump,
      answers,
      project_id: typeof project_id === 'string' && project_id ? project_id : null,
      apiKey: key,
      baseUrl: typeof baseUrl === 'string' && baseUrl ? baseUrl : undefined,
      model: typeof model === 'string' && model ? model : undefined,
    })
    res.json(result)
  })

  return router
}
