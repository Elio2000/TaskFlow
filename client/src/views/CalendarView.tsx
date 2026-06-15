import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task } from '../api'
import { DateU } from '../utils/date'
import { dragSource, draggedTaskId } from '../utils/drag'
import { yToMin, computeMove, computeResizeTop, computeResizeBottom, minToTime, timeToMin } from '../utils/calendarGeom'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskModal } from '../components/TaskModal'
import { QuickComposer } from '../components/QuickComposer'
import { AIPanel } from '../ai/AIPanel'

type CalMode = 'month' | 'week'
const HOUR_PX = 56

/* ============ MonthView ============ */
function MonthView({ year, month, tasks, today, selected, onSelect, onOpenTask, onMoveTask }: {
  year: number; month: number; tasks: Task[]; today: string; selected: string;
  onSelect: (d: string) => void; onOpenTask: (id: string) => void; onMoveTask: (taskId: string, date: string) => void;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null)
  const grid = DateU.monthGrid(year, month)
  const tbd: Record<string, Task[]> = {}
  tasks.filter(t => !t.completed && !t.parent_id && t.due_date).forEach(t => {
    if (!tbd[t.due_date!]) tbd[t.due_date!] = []
    tbd[t.due_date!].push(t)
  })
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
        {['一','二','三','四','五','六','日'].map(w => <div key={w} style={{ textAlign:'center',fontSize:12,color:'var(--text-tertiary)',padding:'4px 0',fontWeight:500 }}>{w}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {grid.map(c => {
          const ts = tbd[c.date] || []
          const isSel = c.date === selected, isToday = c.date === today
          return (
            <div key={c.date} onClick={() => onSelect(c.date)}
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOver(c.date) }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOver(d => d === c.date ? null : d) }}
              onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = draggedTaskId(e); if (id) onMoveTask(id, c.date) }}
              style={{ minHeight:70,borderRadius:8,padding:'5px 6px',cursor:'pointer',background:dragOver===c.date?'var(--accent-soft)':isSel?'var(--accent-soft)':isToday?'var(--bg-hover)':c.inMonth?'var(--bg-card)':'transparent',border:(isSel||dragOver===c.date)?'1.5px solid var(--accent)':'1px solid var(--border-soft)',opacity:c.inMonth?1:.4 }}>
              <div style={{ fontSize:12.5,fontWeight:isToday||isSel?700:400,color:isToday?'var(--accent-text)':isSel?'var(--accent-text)':'var(--text-primary)',marginBottom:3,textAlign:'right' }}>{c.day}</div>
              {ts.slice(0,3).map(t => (
                <div key={t.id} {...dragSource(t.id)} onClick={e=>{e.stopPropagation();onOpenTask(t.id)}} style={{ fontSize:11,padding:'1px 4px',borderRadius:3,marginBottom:1,background:'var(--accent-soft)',color:'var(--accent-text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'grab' }}>{t.title}</div>
              ))}
              {ts.length>3 && <div style={{ fontSize:10.5,color:'var(--text-tertiary)',paddingLeft:4 }}>+{ts.length-3}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ============ DayCol ============ */
type BlockDrag = { task: Task; preview: { date: string; startMin: number; endMin: number } }

function DayCol({ date, tasks, onSlotClick, onOpenTask, onDropTask, drag, onStartBlockDrag }: {
  date: string; tasks: Task[]; onSlotClick: (date: string, startMin: number, endMin: number) => void; onOpenTask: (id: string) => void;
  onDropTask: (taskId: string, date: string, minutes: number) => void;
  drag: BlockDrag | null; onStartBlockDrag: (task: Task, mode: 'move' | 'resize-top' | 'resize-bottom', date: string, e: React.PointerEvent) => void;
}) {
  const [cm, setCm] = useState(()=>{const n=new Date();return n.getHours()*60+n.getMinutes()})
  const [slotStart, setSlotStart] = useState<number | null>(null)
  const [slotEnd, setSlotEnd] = useState<number | null>(null)
  const timeGridRef = useRef<HTMLDivElement>(null)
  useEffect(()=>{const id=setInterval(()=>{const n=new Date();setCm(n.getHours()*60+n.getMinutes())},60000);return ()=>clearInterval(id)},[])
  const allDay = tasks.filter(t => !t.due_time && !t.completed)
  const timed = tasks.filter(t => t.due_time && !t.completed)
  const localMin = (clientY: number) => yToMin(clientY, timeGridRef.current?.getBoundingClientRect().top ?? 0, HOUR_PX)

  const renderBlock = (task: Task, sMin: number, eMin: number, ghost: boolean) => {
    const top = sMin * (HOUR_PX / 60)
    const h = Math.max(22, (eMin - sMin) * (HOUR_PX / 60))
    return (
      <div key={task.id + (ghost ? '_g' : '')} data-task-block="1"
        onPointerDown={ghost ? undefined : (e) => onStartBlockDrag(task, 'move', date, e)}
        style={{ position:'absolute',left:2,right:2,top,height:h,background:'var(--accent-soft)',color:'var(--accent-text)',borderRadius:4,padding:'2px 4px',fontSize:11,cursor:ghost?'grabbing':'grab',zIndex:ghost?6:1,overflow:'hidden',opacity:ghost?0.85:1,boxShadow:ghost?'0 2px 8px rgba(0,0,0,.18)':'none',pointerEvents:ghost?'none':'auto',boxSizing:'border-box',touchAction:'none' }}>
        {!ghost && <div onPointerDown={(e)=>{e.stopPropagation();onStartBlockDrag(task,'resize-top',date,e)}} style={{ position:'absolute',top:0,left:0,right:0,height:6,cursor:'ns-resize' }} />}
        <div style={{ fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{task.title}</div>
        <div style={{ fontSize:10 }}>{minToTime(sMin)} – {minToTime(eMin)}</div>
        {!ghost && <div onPointerDown={(e)=>{e.stopPropagation();onStartBlockDrag(task,'resize-bottom',date,e)}} style={{ position:'absolute',bottom:0,left:0,right:0,height:6,cursor:'ns-resize' }} />}
      </div>
    )
  }

  return (
    <div style={{ flex:1,minWidth:0,borderLeft:'1px solid var(--border-soft)',position:'relative' }}>
      <div style={{ height:38,borderBottom:'1px solid var(--border-soft)',padding:'2px 4px',overflowY:'auto' }}>
        {allDay.map(t=><div key={t.id} {...dragSource(t.id)} onClick={()=>onOpenTask(t.id)} title="拖到时间轴可安排具体时间" style={{ fontSize:11,padding:'1px 4px',borderRadius:3,background:'var(--accent-soft)',color:'var(--accent-text)',cursor:'grab',marginBottom:2,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis' }}>{t.title}</div>)}
      </div>
      <div ref={timeGridRef} data-daycol={date} style={{ position:'relative',height:24*HOUR_PX }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={e => { e.preventDefault(); const id = draggedTaskId(e); if (id) onDropTask(id, date, localMin(e.clientY)) }}
        onPointerDown={e => { if (e.button !== 0) return; if ((e.target as HTMLElement).closest('[data-task-block]')) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); const m = localMin(e.clientY); setSlotStart(m); setSlotEnd(m+30) }}
        onPointerMove={e => { if (slotStart == null) return; setSlotEnd(localMin(e.clientY)) }}
        onPointerUp={e => {
          if (slotStart == null) return
          const end = localMin(e.clientY)
          const s = Math.min(slotStart, end), e2 = Math.max(slotStart, end)
          onSlotClick(date, s, s + Math.max(30, e2 - s))
          setSlotStart(null); setSlotEnd(null)
        }}>
        {date===DateU.today() && <div style={{ position:'absolute',left:0,right:0,top:cm*(HOUR_PX/60),height:2,background:'var(--p1)',zIndex:10 }}><div style={{ width:8,height:8,borderRadius:'50%',background:'var(--p1)',position:'absolute',left:-4,top:-3 }}/></div>}
        {slotStart != null && slotEnd != null && (
          <div style={{ position:'absolute',left:2,right:2,top:Math.min(slotStart,slotEnd)*(HOUR_PX/60),height:Math.abs(slotEnd-slotStart)*(HOUR_PX/60),background:'var(--accent-soft)',border:'2px dashed var(--accent)',borderRadius:7,pointerEvents:'none',zIndex:20,padding:'4px 8px',boxSizing:'border-box',fontSize:11,color:'var(--accent-text)',fontWeight:600 }}>
            {minToTime(Math.min(slotStart,slotEnd))} – {minToTime(Math.max(slotStart,slotEnd))}
          </div>
        )}
        {timed.filter(t => drag?.task.id !== t.id).map(t => renderBlock(t, timeToMin(t.due_time), t.end_time ? timeToMin(t.end_time) : timeToMin(t.due_time) + 60, false))}
        {drag && drag.preview.date === date && renderBlock(drag.task, drag.preview.startMin, drag.preview.endMin, true)}
      </div>
    </div>
  )
}

/* ============ TimeGrid ============ */
function TimeGrid({ dates, tasks, onSlotClick, onOpenTask, onDropTask, onCommitBlock }: {
  dates: string[]; tasks: Task[]; onSlotClick: (date: string, startMin: number, endMin: number) => void; onOpenTask: (id: string) => void;
  onDropTask: (taskId: string, date: string, minutes: number) => void;
  onCommitBlock: (taskId: string, date: string, startMin: number, endMin: number) => void;
}) {
  const [drag, setDrag] = useState<BlockDrag | null>(null)

  // Pointer-based move/resize of a timed block. Tracks via document listeners so a
  // move can cross day columns; click-vs-drag is disambiguated by a 4px threshold.
  const startBlockDrag = (task: Task, mode: 'move' | 'resize-top' | 'resize-bottom', date: string, e: React.PointerEvent) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const grids = [...document.querySelectorAll<HTMLElement>('[data-daycol]')]
    const gridTop = grids[0]?.getBoundingClientRect().top ?? 0
    const startMin0 = timeToMin(task.due_time)
    const endMin0 = task.end_time ? timeToMin(task.end_time) : startMin0 + 60
    const grabOffset = yToMin(e.clientY, gridTop, HOUR_PX) - startMin0
    const dur = endMin0 - startMin0
    const startX = e.clientX, startY = e.clientY
    let moved = false
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - startX) < 4 && Math.abs(ev.clientY - startY) < 4) return
      moved = true
      const pm = yToMin(ev.clientY, gridTop, HOUR_PX)
      let d = date
      let se: { start: number; end: number }
      if (mode === 'move') {
        se = computeMove(pm, grabOffset, dur)
        for (const g of grids) { const r = g.getBoundingClientRect(); if (ev.clientX >= r.left && ev.clientX < r.right) { d = g.dataset.daycol || date; break } }
      } else if (mode === 'resize-top') se = computeResizeTop(pm, endMin0)
      else se = computeResizeBottom(pm, startMin0)
      setDrag({ task, preview: { date: d, startMin: se.start, endMin: se.end } })
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      if (moved) setDrag(cur => { if (cur) onCommitBlock(cur.task.id, cur.preview.date, cur.preview.startMin, cur.preview.endMin); return null })
      else { setDrag(null); onOpenTask(task.id) }
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    setDrag({ task, preview: { date, startMin: startMin0, endMin: endMin0 } })
  }

  return (
    <div style={{ display:'flex',flex:1,overflowY:'auto',minHeight:0 }}>
      <div style={{ width:48,flexShrink:0 }}>
        {Array.from({length:24},(_,h)=><div key={h} style={{ height:HOUR_PX,paddingRight:8,fontSize:11,color:'var(--text-tertiary)',textAlign:'right' }}>{h===0?'':`${h}:00`}</div>)}
      </div>
      {dates.map(date=><DayCol key={date} date={date} tasks={tasks.filter(t=>t.due_date===date&&!t.completed&&!t.parent_id)} onSlotClick={onSlotClick} onOpenTask={onOpenTask} onDropTask={onDropTask} drag={drag} onStartBlockDrag={startBlockDrag} />)}
    </div>
  )
}

/* ============ CreatePanel ============ */
function CreatePanel({ slot, onCommit, onCancel }: { slot:{date:string;startTime:string;endTime:string}; onCommit:(title:string)=>void; onCancel:()=>void }) {
  const [title, setTitle] = useState('')
  return (
    <div className="modal-scrim" onClick={e=>{if(e.target===e.currentTarget)onCancel()}}>
      <div className="modal-card" style={{ maxWidth:340,marginTop:'12vh',padding:20 }} onClick={e=>e.stopPropagation()}>
        <div style={{ fontWeight:600,fontSize:15,marginBottom:12 }}>新建任务</div>
        <input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.nativeEvent.isComposing&&title.trim()){onCommit(title.trim());setTitle('')}if(e.key==='Escape')onCancel()}} placeholder="任务名称…" style={{ width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:14,marginBottom:8,background:'var(--bg-content)',color:'var(--text-primary)',outline:'none' }}/>
        <div style={{ fontSize:12,color:'var(--text-tertiary)',marginBottom:12 }}>{DateU.human(slot.date)} {slot.startTime} – {slot.endTime}</div>
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <button className="btn-ghost" onClick={onCancel}>取消</button>
          <button className="btn-primary" onClick={()=>{if(title.trim()){onCommit(title.trim());setTitle('')}}} disabled={!title.trim()}>创建</button>
        </div>
      </div>
    </div>
  )
}

function titleFor(mode: CalMode, cursor: string): string {
  const d = new Date(cursor+'T00:00:00')
  if (mode==='month') return d.getFullYear()+'年'+(d.getMonth()+1)+'月'
  const week = DateU.weekDates(cursor)
  const sd = new Date(week[0]+'T00:00:00'), ed = new Date(week[6]+'T00:00:00')
  return sd.getMonth()===ed.getMonth() ? `${sd.getMonth()+1}月${sd.getDate()}日 – ${ed.getDate()}日` : `${sd.getMonth()+1}月${sd.getDate()}日 – ${ed.getMonth()+1}月${ed.getDate()}日`
}

export function CalendarView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [mode, setMode] = useState<CalMode>('month')
  const [cursor, setCursor] = useState(DateU.today())
  const [selected, setSelected] = useState(DateU.today())
  const [taskModal, setTaskModal] = useState<string|null>(null)
  const [aiOpen, setAiOpen] = useState(false)
  const [aiTask, setAiTask] = useState<Task|null>(null)
  const [createSlot, setCreateSlot] = useState<{date:string;startTime:string;endTime:string}|null>(null)

  const fetch = () => api.getTasks().then(setTasks)
  useEffect(()=>{fetch();const id=setInterval(fetch,5000);return ()=>clearInterval(id)},[])

  const today = DateU.today()
  const navigate = (dir:1|-1) => { if (mode==='month') setCursor(DateU.addMonths(cursor,dir)); else setCursor(DateU.addDays(cursor,dir*7)) }
  // Drag a task onto a calendar day → set its due_date (due_time preserved)
  const handleMoveToDate = async (taskId: string, date: string) => { await api.updateTask(taskId, { due_date: date } as any); fetch() }
  // Drop an all-day task onto the week grid → give it a concrete time (default 60-min block)
  const handleDropToSlot = async (taskId: string, date: string, minutes: number) => {
    await api.updateTask(taskId, { due_date: date, due_time: minToTime(minutes), end_time: minToTime(Math.min(24 * 60, minutes + 60)) } as any); fetch()
  }
  // Commit a pointer move/resize of a timed block (week view)
  const handleCommitBlock = async (taskId: string, date: string, startMin: number, endMin: number) => {
    await api.updateTask(taskId, { due_date: date, due_time: minToTime(startMin), end_time: minToTime(endMin) } as any); fetch()
  }
  const weekDates = DateU.weekDates(cursor)
  const dayTasks = tasks.filter(t=>t.due_date===selected&&!t.parent_id&&!t.completed)

  return (
    <div className="fade-up" style={{ display:'flex',flexDirection:'column',minHeight:'100%',background:'var(--bg-content)' }}>
      <div style={{ padding:'20px 24px 10px',borderBottom:'1px solid var(--border-soft)',flexShrink:0 }}>
        <div style={{ display:'flex',alignItems:'center',gap:8 }}>
          <button className="btn-ghost" onClick={()=>navigate(-1)}><Icon name="chevronLeft" size={15}/></button>
          <button className="btn-ghost" onClick={()=>{setCursor(today);setSelected(today)}} style={{ fontSize:12.5 }}>今天</button>
          <button className="btn-ghost" onClick={()=>navigate(1)}><Icon name="chevronRight" size={15}/></button>
          <span style={{ flex:1,fontSize:16,fontWeight:700 }}>{titleFor(mode,cursor)}</span>
          <div style={{ display:'flex',gap:2,background:'var(--bg-inset)',borderRadius:8,padding:3 }}>
            {(['month','week'] as CalMode[]).map(m=>(
              <button key={m} className={mode===m?'btn-primary':'btn-ghost'} style={{ fontSize:12,padding:'3px 10px' }} onClick={()=>setMode(m)}>{{month:'月',week:'周'}[m]}</button>
            ))}
          </div>
        </div>
      </div>

      {mode==='month' && (
        <div style={{ padding:'10px 24px 24px',display:'grid',gridTemplateColumns:'1fr 300px',gap:24,flex:1,overflow:'hidden' }}>
          <div style={{ overflowY:'auto' }}>
            <MonthView year={new Date(cursor+'T00:00:00').getFullYear()} month={new Date(cursor+'T00:00:00').getMonth()} tasks={tasks} today={today} selected={selected} onSelect={setSelected} onOpenTask={setTaskModal} onMoveTask={handleMoveToDate}/>
          </div>
          <div style={{ borderLeft:'1px solid var(--border-soft)',paddingLeft:20,overflowY:'auto' }}>
            <div style={{ fontWeight:600,fontSize:14.5,marginBottom:10,color:selected===today?'var(--accent-text)':'var(--text-primary)' }}>{DateU.human(selected)} <span style={{ fontWeight:400,fontSize:12.5,color:'var(--text-tertiary)' }}>({dayTasks.length} 条)</span></div>
            <QuickComposer projectId="inbox" defaultDueDate={selected} placeholder="为这天添加任务…" autoFocus={false} onDone={fetch}/>
            {dayTasks.length===0 ? <div style={{ fontSize:13,color:'var(--text-tertiary)',paddingTop:8 }}>无任务</div> : dayTasks.map(t=><TaskRow key={t.id} task={t} draggable showProject onClick={()=>setTaskModal(t.id)} onAIClick={task=>{setAiTask(task);setAiOpen(true)}} onDelete={fetch} onToggle={fetch}/>)}
          </div>
        </div>
      )}

      {mode==='week' && (
        <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
          <div style={{ display:'grid',gridTemplateColumns:`48px repeat(7,1fr)`,borderBottom:'1px solid var(--border-soft)',flexShrink:0 }}>
            <div/>
            {weekDates.map(date=>{const isToday=date===today;const d=new Date(date+'T00:00:00');return <div key={date} style={{ textAlign:'center',padding:'7px 4px' }}><div style={{ fontSize:11,color:'var(--text-tertiary)',marginBottom:2 }}>周{DateU.weekdayCN(date)}</div><div style={{ width:28,height:28,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',background:isToday?'var(--accent)':'transparent',color:isToday?'#fff':'var(--text-primary)',fontWeight:isToday?700:400,fontSize:14 }}>{d.getDate()}</div></div>})}
          </div>
          <TimeGrid dates={weekDates} tasks={tasks} onSlotClick={(date,startMin,endMin)=>{const pad=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');setCreateSlot({date,startTime:pad(startMin),endTime:pad(endMin)})}} onOpenTask={setTaskModal} onDropTask={handleDropToSlot} onCommitBlock={handleCommitBlock}/>
        </div>
      )}

      {createSlot && <CreatePanel slot={createSlot} onCommit={async title=>{await api.addTask({title,due_date:createSlot.date,due_time:createSlot.startTime,end_time:createSlot.endTime,project_id:'inbox'} as any);setCreateSlot(null);fetch()}} onCancel={()=>setCreateSlot(null)}/>}
      {taskModal && <TaskModal taskId={taskModal} onClose={()=>{setTaskModal(null);fetch()}}/>}
      {aiOpen && <AIPanel projectId={aiTask?.project_id||'inbox'} refTask={aiTask} layout="float" onClose={()=>setAiOpen(false)}/>}
    </div>
  )
}
