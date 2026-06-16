import { useState, useEffect, useRef, type FC } from 'react'
import { Popover } from './Popover'
import { Icon } from '../icons'
import { DateU } from '../utils/date'
import { parse } from '../nlp'
import { minToTime } from '../utils/calendarGeom'

interface DateMenuProps {
  value: string | null
  time: string | null
  repeat: string | null
  endTime?: string | null
  startDate?: string | null
  /** Date-only mode: hide the start/end time + repeat controls (used by the start-date picker). */
  dateOnly?: boolean
  /** Show the 日期 / 时间段 tabs so a date range (start_date → due_date) can be picked. */
  allowRange?: boolean
  onPick: (result: { start_date: string | null; due_date: string | null; due_time: string | null; end_time: string | null; repeat: string | null }) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const REPEAT_OPTS: { value: string; label: string }[] = [
  { value: '', label: '不重复' },
  { value: 'daily', label: '每天' },
  { value: 'weekly', label: '每周' },
  { value: 'monthly', label: '每月' },
]

// 00:00, 00:30, … 23:30 — the only time granularity the app offers.
const TIME_OPTS = Array.from({ length: 48 }, (_, i) => minToTime(i * 30))

// 30-min time dropdown — custom (no native <input type=time>) so it matches the app's
// design. Renders an absolutely-positioned scrollable list inside the DateMenu (NOT a
// nested portal) and closes on outside mousedown.
const TimeSelect: FC<{ label: string; value: string; onChange: (v: string) => void }> = ({ label, value, onChange }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  // Ref callback fires when the dropdown mounts — jump it to the selected time, or the
  // current 30-min slot if none, so the user lands near "now" instead of at 00:00.
  // rAF so the list is laid out (scrollHeight final) before we set scrollTop.
  const scrollToNow = (list: HTMLDivElement | null) => {
    if (!list) return
    const now = new Date()
    const target = value || minToTime(Math.floor((now.getHours() * 60 + now.getMinutes()) / 30) * 30)
    const el = list.querySelector<HTMLElement>(`[data-time="${target}"]`)
    if (el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2
  }
  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: '5px 9px', background: 'var(--bg-content)', cursor: 'pointer' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text-tertiary)', flex: 'none' }}>{label}</span>
        <span style={{ flex: 1, textAlign: 'left', fontSize: 12.5, color: value ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{value || '--:--'}</span>
        <Icon name="clock" size={13} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
      </button>
      {open && (
        <div ref={scrollToNow} style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, maxHeight: 184, overflowY: 'auto', zIndex: 40, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-modal)', padding: 4 }}>
          {value && <button className="menu-item" style={{ color: 'var(--text-tertiary)' }} onClick={() => { onChange(''); setOpen(false) }}>清除</button>}
          {TIME_OPTS.map(o => (
            <button key={o} data-time={o} className="menu-item" style={o === value ? { background: 'var(--accent-soft)', color: 'var(--accent-text)', fontWeight: 600 } : undefined}
              onClick={() => { onChange(o); setOpen(false) }}>{o}</button>
          ))}
        </div>
      )}
    </div>
  )
}

export const DateMenu: FC<DateMenuProps> = ({ value, time, repeat, endTime, startDate, dateOnly, allowRange, onPick, onClose, anchorRef }) => {
  const t = DateU.today()
  const [mode, setMode] = useState<'single' | 'range'>(allowRange && startDate ? 'range' : 'single')
  const [view, setView] = useState(() => {
    const d = (value || startDate) ? DateU.parse((value || startDate)!) : new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [text, setText] = useState('')
  const [timeVal, setTimeVal] = useState(time || '')
  const [endTimeVal, setEndTimeVal] = useState(endTime || '')
  const [repeatVal, setRepeatVal] = useState(repeat || null)
  // Range mode
  const [rangeStart, setRangeStart] = useState<string | null>(startDate || value || null)
  const [rangeEnd, setRangeEnd] = useState<string | null>(startDate ? value : null)
  const [activeField, setActiveField] = useState<'start' | 'end'>('start')
  const parsed = text ? parse(text, {}) : null

  const quick = [
    { label: '今天', date: t, hint: '周' + DateU.weekdayCN(t), icon: 'today' },
    { label: '明天', date: DateU.addDays(t, 1), hint: '周' + DateU.weekdayCN(DateU.addDays(t, 1)), icon: 'sun' },
    { label: '不设日期', date: null, hint: '', icon: 'circleDashed' },
  ]

  const grid = DateU.monthGrid(view.y, view.m)

  const commitSingle = (date: string | null) =>
    onPick({
      start_date: null,
      due_date: date,
      due_time: date && !dateOnly ? timeVal || null : null,
      end_time: date && !dateOnly ? endTimeVal || null : null,
      repeat: date && !dateOnly ? repeatVal : null,
    })

  const commitRange = () => {
    let s = rangeStart, e = rangeEnd || rangeStart
    if (s && e && s > e) { const tmp = s; s = e; e = tmp }   // normalize start ≤ end
    onPick({ start_date: s, due_date: e, due_time: timeVal || null, end_time: endTimeVal || null, repeat: repeatVal })
  }

  const onDayClick = (date: string) => {
    if (mode === 'single') { commitSingle(date); return }
    if (activeField === 'start') {
      setRangeStart(date); setActiveField('end')
      if (rangeEnd && date > rangeEnd) setRangeEnd(null)
    } else {
      setRangeEnd(date); setActiveField('start')
    }
  }

  const inRange = (d: string) => {
    if (mode !== 'range' || !rangeStart || !rangeEnd) return false
    const lo = rangeStart <= rangeEnd ? rangeStart : rangeEnd
    const hi = rangeStart <= rangeEnd ? rangeEnd : rangeStart
    return d >= lo && d <= hi
  }
  const isEndpoint = (d: string) => mode === 'range' ? (d === rangeStart || d === rangeEnd) : d === value

  const monthNav = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 6px' }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{view.y}年{view.m + 1}月</span>
      <span style={{ display: 'flex', gap: 2 }}>
        <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setView(v => ({ y: v.m === 0 ? v.y - 1 : v.y, m: v.m === 0 ? 11 : v.m - 1 }))}><Icon name="chevronLeft" size={14} /></button>
        <button className="btn-icon" style={{ width: 24, height: 24 }} onClick={() => setView(v => ({ y: v.m === 11 ? v.y + 1 : v.y, m: v.m === 11 ? 0 : v.m + 1 }))}><Icon name="chevronRight" size={14} /></button>
      </span>
    </div>
  )

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={280}>
      <div style={{ padding: 10 }}>
        {allowRange && !dateOnly && (
          <div style={{ display: 'flex', gap: 4, background: 'var(--bg-inset)', borderRadius: 8, padding: 3, marginBottom: 8 }}>
            {([['single', '日期'], ['range', '时间段']] as const).map(([m, l]) => (
              <button key={m} className={mode === m ? 'btn-primary' : 'btn-ghost'} style={{ flex: 1, fontSize: 12.5, padding: '4px 0', justifyContent: 'center' }} onClick={() => setMode(m)}>{l}</button>
            ))}
          </div>
        )}

        {mode === 'single' ? (
          <>
            <input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="输入日期，如「下周三」「6月20日」"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && parsed && parsed.due_date) commitSingle(parsed.due_date) }}
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--bg-content)', outline: 'none' }} />
            {parsed && parsed.due_date && (
              <button className="menu-item" style={{ marginTop: 6, color: 'var(--accent-text)' }} onClick={() => commitSingle(parsed.due_date!)}>
                <Icon name="calendar" size={15} /> {DateU.human(parsed.due_date)}<span className="menu-hint">回车确认</span>
              </button>
            )}
            {!text && (
              <div style={{ marginTop: 6 }}>
                {quick.map((q) => (
                  <button key={q.label} className="menu-item" onClick={() => commitSingle(q.date)}>
                    <Icon name={q.icon} size={15} style={{ color: q.date === t ? 'var(--green)' : 'var(--text-secondary)' }} />
                    {q.label}<span className="menu-hint">{q.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            {(['start', 'end'] as const).map((f) => {
              const d = f === 'start' ? rangeStart : rangeEnd
              const active = activeField === f
              return (
                <button key={f} onClick={() => setActiveField(f)}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'), borderRadius: 8, padding: '5px 9px', background: 'var(--bg-content)', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{f === 'start' ? '开始' : '截止'}</span>
                  <span style={{ fontSize: 13, color: d ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>{d ? DateU.human(d) : '选择日期'}</span>
                </button>
              )
            })}
          </div>
        )}

        <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}>
          {monthNav}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, fontSize: 11.5, color: 'var(--text-tertiary)', textAlign: 'center', marginBottom: 3 }}>
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => <span key={w}>{w}</span>)}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {grid.map((c) => {
              const endpoint = isEndpoint(c.date)
              const ranged = !endpoint && inRange(c.date)
              const isToday = c.date === t
              return (
                <button key={c.date} onClick={() => onDayClick(c.date)}
                  style={{
                    border: 'none', cursor: 'pointer', borderRadius: 7, padding: '4px 0', fontSize: 12.5,
                    background: endpoint ? 'var(--accent)' : ranged ? 'var(--accent-soft)' : 'transparent',
                    color: endpoint ? '#fff' : ranged ? 'var(--accent-text)' : isToday ? 'var(--accent-text)' : c.inMonth ? 'var(--text-primary)' : 'var(--text-tertiary)',
                    fontWeight: isToday || endpoint ? 700 : 400,
                  }}
                  onMouseEnter={(e) => { if (!endpoint && !ranged) e.currentTarget.style.background = 'var(--bg-hover)' }}
                  onMouseLeave={(e) => { if (!endpoint && !ranged) e.currentTarget.style.background = 'transparent' }}>
                  {c.day}
                </button>
              )
            })}
          </div>
        </div>

        {!dateOnly && (
          <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <TimeSelect label="开始" value={timeVal} onChange={setTimeVal} />
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12, flex: 'none' }}>–</span>
              <TimeSelect label="截止" value={endTimeVal} onChange={setEndTimeVal} />
            </div>
            <div style={{ display: 'flex', gap: 5, marginTop: 8 }}>
              {REPEAT_OPTS.map((o) => {
                const active = (repeatVal || '') === o.value
                return (
                  <button key={o.value} onClick={() => setRepeatVal(o.value || null)}
                    style={{ flex: 1, fontSize: 12, padding: '5px 0', borderRadius: 7, cursor: 'pointer', border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'), background: active ? 'var(--accent-soft)' : 'transparent', color: active ? 'var(--accent-text)' : 'var(--text-secondary)', fontWeight: active ? 600 : 400 }}>
                    {o.label}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {mode === 'range' ? (
          <button className="btn-primary" style={{ width: '100%', marginTop: 8, opacity: rangeStart ? 1 : 0.5 }} disabled={!rangeStart} onClick={commitRange}>应用</button>
        ) : (!dateOnly && (timeVal || endTimeVal || repeatVal) && value && (
          <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => commitSingle(value)}>应用</button>
        ))}
      </div>
    </Popover>
  )
}
