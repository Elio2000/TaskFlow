const pad = (n: number) => String(n).padStart(2, '0')
const fmt = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())

function nextWeekday(base: Date, weekday: number, forceNextWeek: boolean): Date {
  const d = new Date(base)
  const cur = d.getDay() === 0 ? 7 : d.getDay()
  let diff = weekday - cur
  if (forceNextWeek) diff += diff <= 0 ? 7 : (cur > weekday ? 7 : 7)
  else if (diff <= 0) diff += 7
  d.setDate(d.getDate() + diff)
  return d
}

const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

type RuleHandler = (m: RegExpExecArray, base: Date) => { due_date?: string; due_time?: string; repeat?: string; label: string } | null

const DATE_RULES: [RegExp, RuleHandler][] = [
  [/今天|today/i, (_, b) => ({ due_date: fmt(b), label: '今天' })],
  [/明天|tomorrow|tmr/i, (_, b) => { const d = new Date(b); d.setDate(d.getDate() + 1); return { due_date: fmt(d), label: '明天' } }],
  [/后天/, (_, b) => { const d = new Date(b); d.setDate(d.getDate() + 2); return { due_date: fmt(d), label: '后天' } }],
  [/大后天/, (_, b) => { const d = new Date(b); d.setDate(d.getDate() + 3); return { due_date: fmt(d), label: '大后天' } }],
  [/下下?(?:周|星期|礼拜)([一二三四五六日天])/, (m, b) => {
    const two = m[0].startsWith('下下')
    let d = nextWeekday(b, CN_NUM[m[1]], true)
    if (two) { d = new Date(d); d.setDate(d.getDate() + 7) }
    return { due_date: fmt(d), label: m[0] }
  }],
  [/(?:这|本)?(?:周|星期|礼拜)([一二三四五六日天])/, (m, b) => ({ due_date: fmt(nextWeekday(b, CN_NUM[m[1]], false)), label: m[0] })],
  [/下周|next week/i, (_, b) => ({ due_date: fmt(nextWeekday(b, 1, true)), label: '下周' })],
  [/这周末|周末|this weekend/i, (_, b) => ({ due_date: fmt(nextWeekday(b, 6, false)), label: '周末' })],
  [/(\d{1,2})月(\d{1,2})[日号]/, (m, b) => {
    const d = new Date(b.getFullYear(), +m[1] - 1, +m[2])
    if (d < b && (b.getTime() - d.getTime()) > 86400000) d.setFullYear(d.getFullYear() + 1)
    return { due_date: fmt(d), label: m[0] }
  }],
  [/(\d{1,2})[\/\-](\d{1,2})(?![\/\-\d])/, (m, b) => {
    const d = new Date(b.getFullYear(), +m[1] - 1, +m[2])
    if (d < b && (b.getTime() - d.getTime()) > 86400000) d.setFullYear(d.getFullYear() + 1)
    return { due_date: fmt(d), label: m[0] }
  }],
  [/(\d{1,2})[日号](?![\d月])/, (m, b) => {
    let d = new Date(b.getFullYear(), b.getMonth(), +m[1])
    if (d < b && fmt(d) !== fmt(b)) d = new Date(b.getFullYear(), b.getMonth() + 1, +m[1])
    return { due_date: fmt(d), label: m[0] }
  }],
]

const TIME_RULES: [RegExp, RuleHandler][] = [
  [/(上午|早上|凌晨)\s*(\d{1,2})[点时](半)?/, (m) => ({ due_time: pad(+m[2] === 12 ? 0 : +m[2]) + ':' + (m[3] ? '30' : '00'), label: m[0] })],
  [/(下午|晚上|傍晚)\s*(\d{1,2})[点时](半)?/, (m) => {
    let h = +m[2]; if (h < 12) h += 12
    return { due_time: pad(h) + ':' + (m[3] ? '30' : '00'), label: m[0] }
  }],
  [/中午/, () => ({ due_time: '12:00', label: '中午' })],
  [/(\d{1,2}):(\d{2})/, (m) => ({ due_time: pad(+m[1]) + ':' + m[2], label: m[0] })],
  [/(\d{1,2})\s*(am|pm)/i, (m) => {
    let h = +m[1]
    if (/pm/i.test(m[2]) && h < 12) h += 12
    if (/am/i.test(m[2]) && h === 12) h = 0
    return { due_time: pad(h) + ':00', label: m[0] }
  }],
  [/(\d{1,2})[点时](半)?(?!\d)/, (m) => {
    let h = +m[1]
    if (h >= 1 && h <= 6) h += 12
    return { due_time: pad(h) + ':' + (m[2] ? '30' : '00'), label: m[0] }
  }],
]

const REPEAT_RULES: [RegExp, () => { repeat: string; label: string }][] = [
  [/每天|每日|daily/i, () => ({ repeat: 'daily', label: '每天' })],
  [/每周|每星期|weekly/i, () => ({ repeat: 'weekly', label: '每周' })],
  [/每月|monthly/i, () => ({ repeat: 'monthly', label: '每月' })],
]

interface NLPContext {
  projects?: { id: string; name: string }[]
  labels?: { id: string; name: string }[]
}

interface Token {
  start: number
  end: number
  type: string
  label: string
}

interface NLPResult {
  title: string
  due_date: string | null
  due_time: string | null
  priority: number | null
  project_id: string | null
  label_ids: string[]
  repeat: string | null
  tokens: Token[]
}

export function parse(text: string, _ctx: NLPContext = {}): NLPResult {
  const base = new Date()
  const result: NLPResult = {
    title: text, due_date: null, due_time: null, priority: null,
    project_id: null, label_ids: [], repeat: null, tokens: [],
  }
  if (!text) return result

  const consumed: Token[] = []
  const overlaps = (s: number, e: number) => consumed.some((c) => s < c.end && e > c.start)
  const claim = (s: number, e: number, type: string, label: string) => { consumed.push({ start: s, end: e, type, label }) }

  // 1. Priority
  const pm = /(?:^|\s)(?:p|P|!)([1-4])(?=\s|$)/.exec(text)
  if (pm) {
    result.priority = +pm[1]
    const s = pm.index + pm[0].search(/[pP!]/)
    claim(s, pm.index + pm[0].length, 'priority', 'P' + pm[1])
  }

  // 2. #Label (Obsidian style)
  for (const m of text.matchAll(/#([^\s#@]+)/g)) {
    const name = m[1]
    if (!overlaps(m.index, m.index + m[0].length)) {
      // Push as label - caller should resolve/create label ids
      result.label_ids.push(name)
      claim(m.index, m.index + m[0].length, 'label', name)
    }
  }

  // 3. @Label (legacy, still supported)
  for (const m of text.matchAll(/@([^\s#@]+)/g)) {
    const name = m[1]
    if (!overlaps(m.index, m.index + m[0].length)) {
      if (!result.label_ids.includes(name)) {
        result.label_ids.push(name)
      }
      claim(m.index, m.index + m[0].length, 'label', name)
    }
  }

  // 4. Repeat
  for (const [re, fn] of REPEAT_RULES) {
    const m = re.exec(text)
    if (m && !overlaps(m.index, m.index + m[0].length)) {
      const r = fn()
      result.repeat = r.repeat
      claim(m.index, m.index + m[0].length, 'repeat', r.label)
      break
    }
  }

  // 5. Date
  for (const [re, fn] of DATE_RULES) {
    const m = re.exec(text)
    if (m && !overlaps(m.index, m.index + m[0].length)) {
      const r = fn(m, base)
      if (r) {
        result.due_date = r.due_date ?? null
        claim(m.index, m.index + m[0].length, 'date', r.label)
        break
      }
    }
  }

  // If repeat has no date, default to today
  if (result.repeat && !result.due_date) result.due_date = fmt(base)

  // 6. Time
  for (const [re, fn] of TIME_RULES) {
    const m = re.exec(text)
    if (m && !overlaps(m.index, m.index + m[0].length)) {
      const r = fn(m, base)
      if (r) {
        result.due_time = r.due_time ?? null
        claim(m.index, m.index + m[0].length, 'time', r.label)
        if (!result.due_date) result.due_date = fmt(base)
        break
      }
    }
  }

  // 7. Build title from remaining text
  consumed.sort((a, b) => a.start - b.start)
  let title = ''
  let cursor = 0
  for (const c of consumed) {
    title += text.slice(cursor, c.start)
    cursor = c.end
  }
  title += text.slice(cursor)
  result.title = title.replace(/\s{2,}/g, ' ').trim()
  result.tokens = consumed
  return result
}
