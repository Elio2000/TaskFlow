import { useState, type FC } from 'react'
import { Popover } from './Popover'
import { Icon } from '../icons'
import { DateU } from '../utils/date'
import { parse } from '../nlp'

interface DateMenuProps {
  value: string | null
  time: string | null
  repeat: string | null
  onPick: (result: { due_date: string | null; due_time: string | null; repeat: string | null }) => void
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

export const DateMenu: FC<DateMenuProps> = ({ value, time, repeat, onPick, onClose, anchorRef }) => {
  const t = DateU.today()
  const [view, setView] = useState(() => {
    const d = value ? DateU.parse(value) : new Date()
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [text, setText] = useState('')
  const [timeVal, setTimeVal] = useState(time || '')
  const [repeatVal, setRepeatVal] = useState(repeat || null)
  const parsed = text ? parse(text, {}) : null

  const quick = [
    { label: '今天', date: t, hint: '周' + DateU.weekdayCN(t), icon: 'today' },
    { label: '明天', date: DateU.addDays(t, 1), hint: '周' + DateU.weekdayCN(DateU.addDays(t, 1)), icon: 'sun' },
    {
      label: '下周一',
      date: DateU.fmt(
        (() => {
          const d = new Date()
          d.setDate(d.getDate() + (8 - (d.getDay() || 7) || 7))
          return d
        })(),
      ),
      hint: '',
      icon: 'upcoming',
    },
    { label: '不设日期', date: null, hint: '', icon: 'circleDashed' },
  ]

  const grid = DateU.monthGrid(view.y, view.m)

  const commit = (date: string | null) =>
    onPick({
      due_date: date,
      due_time: date ? timeVal || null : null,
      repeat: date ? repeatVal : null,
    })

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={272}>
      <div style={{ padding: 10 }}>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入日期，如「下周三」「6月20日」"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && parsed && parsed.due_date) commit(parsed.due_date)
          }}
          style={{
            width: '100%',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '7px 10px',
            fontSize: 13,
            background: 'var(--bg-content)',
            outline: 'none',
          }}
        />
        {parsed && parsed.due_date && (
          <button
            className="menu-item"
            style={{ marginTop: 6, color: 'var(--accent-text)' }}
            onClick={() => commit(parsed.due_date!)}
          >
            <Icon name="calendar" size={15} /> {DateU.human(parsed.due_date)}
            <span className="menu-hint">回车确认</span>
          </button>
        )}
        {!text && (
          <div style={{ marginTop: 6 }}>
            {quick.map((q) => (
              <button key={q.label} className="menu-item" onClick={() => commit(q.date)}>
                <Icon
                  name={q.icon}
                  size={15}
                  style={{ color: q.date === t ? 'var(--green)' : 'var(--text-secondary)' }}
                />
                {q.label}
                <span className="menu-hint">{q.hint}</span>
              </button>
            ))}
          </div>
        )}
        <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 8, paddingTop: 8 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 4px 6px',
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {view.y}年{view.m + 1}月
            </span>
            <span style={{ display: 'flex', gap: 2 }}>
              <button
                className="btn-icon"
                style={{ width: 24, height: 24 }}
                onClick={() =>
                  setView((v) => ({
                    y: v.m === 0 ? v.y - 1 : v.y,
                    m: v.m === 0 ? 11 : v.m - 1,
                  }))
                }
              >
                <Icon name="chevronLeft" size={14} />
              </button>
              <button
                className="btn-icon"
                style={{ width: 24, height: 24 }}
                onClick={() =>
                  setView((v) => ({
                    y: v.m === 11 ? v.y + 1 : v.y,
                    m: v.m === 11 ? 0 : v.m + 1,
                  }))
                }
              >
                <Icon name="chevronRight" size={14} />
              </button>
            </span>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 1,
              fontSize: 11.5,
              color: 'var(--text-tertiary)',
              textAlign: 'center',
              marginBottom: 3,
            }}
          >
            {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, 1fr)',
              gap: 1,
            }}
          >
            {grid.map((c) => {
              const sel = c.date === value
              const isToday = c.date === t
              return (
                <button
                  key={c.date}
                  onClick={() => commit(c.date)}
                  style={{
                    border: 'none',
                    cursor: 'pointer',
                    borderRadius: 7,
                    padding: '4px 0',
                    fontSize: 12.5,
                    background: sel ? 'var(--accent)' : 'transparent',
                    color: sel
                      ? '#fff'
                      : isToday
                        ? 'var(--accent-text)'
                        : c.inMonth
                          ? 'var(--text-primary)'
                          : 'var(--text-tertiary)',
                    fontWeight: isToday || sel ? 700 : 400,
                  }}
                  onMouseEnter={(e) => {
                    if (!sel) e.currentTarget.style.background = 'var(--bg-hover)'
                  }}
                  onMouseLeave={(e) => {
                    if (!sel) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {c.day}
                </button>
              )
            })}
          </div>
        </div>
        <div
          style={{
            borderTop: '1px solid var(--border-soft)',
            marginTop: 8,
            paddingTop: 8,
            display: 'flex',
            gap: 6,
          }}
        >
          <label
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12.5,
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '5px 8px',
            }}
          >
            <Icon name="clock" size={14} />
            <input
              type="time"
              value={timeVal}
              onChange={(e) => setTimeVal(e.target.value)}
              style={{
                border: 'none',
                background: 'none',
                outline: 'none',
                fontSize: 12.5,
                width: '100%',
              }}
            />
          </label>
          <select
            value={repeatVal || ''}
            onChange={(e) => setRepeatVal(e.target.value || null)}
            style={{
              flex: 1,
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: '5px 8px',
              fontSize: 12.5,
              background: 'var(--bg-card)',
              color: 'var(--text-secondary)',
              outline: 'none',
            }}
          >
            <option value="">不重复</option>
            <option value="daily">每天</option>
            <option value="weekly">每周</option>
            <option value="monthly">每月</option>
          </select>
        </div>
        {(timeVal || repeatVal) && value && (
          <button className="btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => commit(value)}>
            应用
          </button>
        )}
      </div>
    </Popover>
  )
}
