import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { Task } from '../api'
import { DateU } from '../utils/date'
import { Icon } from '../icons'
import { TaskRow } from '../components/TaskRow'
import { TaskModal } from '../components/TaskModal'
import { QuickComposer } from '../components/QuickComposer'
import { AIPanel } from '../ai/AIPanel'

type CalMode = 'month' | 'week'
const HOUR_PX = 56

/* ============ MonthView ============ */
function MonthView({ year, month, tasks, today, selected, onSelect, onOpenTask }: {
  year: number; month: number; tasks: Task[]; today: string; selected: string;
  onSelect: (d: string) => void; onOpenTask: (id: string) => void;
}) {
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
            <div key={c.date} onClick={() => onSelect(c.date)} style={{ minHeight:70,borderRadius:8,padding:'5px 6px',cursor:'pointer',background:isSel?'var(--accent-soft)':isToday?'var(--bg-hover)':c.inMonth?'var(--bg-card)':'transparent',border:isSel?'1.5px solid var(--accent)':'1px solid var(--border-soft)',opacity:c.inMonth?1:.4 }}>
              <div style={{ fontSize:12.5,fontWeight:isToday||isSel?700:400,color:isToday?'var(--accent-text)':isSel?'var(--accent-text)':'var(--text-primary)',marginBottom:3,textAlign:'right' }}>{c.day}</div>
              {ts.slice(0,3).map(t => (
                <div key={t.id} onClick={e=>{e.stopPropagation();onOpenTask(t.id)}} style={{ fontSize:11,padding:'1px 4px',borderRadius:3,marginBottom:1,background:'var(--accent-soft)',color:'var(--accent-text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',cursor:'pointer' }}>{t.title}</div>
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
function DayCol({ date, tasks, onSlotClick, onOpenTask }: {
  date: string; tasks: Task[]; onSlotClick: (date: string, startMin: number, endMin: number) => void; onOpenTask: (id: string) => void;
}) {
  const [cm, setCm] = useState(()=>{const n=new Date();return n.getHours()*60+n.getMinutes()})
  const [dragStart, setDragStart] = useState<number | null>(null)
  const [dragEnd, setDragEnd] = useState<number | null>(null)
  const colRef = useRef<HTMLDivElement>(null)
  const timeGridRef = useRef<HTMLDivElement>(null)
  useEffect(()=>{const id=setInterval(()=>{const n=new Date();setCm(n.getHours()*60+n.getMinutes())},60000);return ()=>clearInterval(id)},[])
  const allDay = tasks.filter(t => !t.due_time && !t.completed)
  const timed = tasks.filter(t => t.due_time && !t.completed)

  const yToMin = (clientY: number) => {
    if (!timeGridRef.current) return 0
    const rect = timeGridRef.current.getBoundingClientRect()
    return Math.round(Math.max(0, Math.min(24*60, (clientY - rect.top) / HOUR_PX * 60)) / 15) * 15
  }

  return (
    <div ref={colRef} style={{ flex:1,minWidth:0,borderLeft:'1px solid var(--border-soft)',position:'relative' }}>
      <div style={{ minHeight:32,borderBottom:'1px solid var(--border-soft)',padding:'2px 4px' }}>
        {allDay.slice(0,2).map(t=><div key={t.id} onClick={()=>onOpenTask(t.id)} style={{ fontSize:11,padding:'1px 4px',borderRadius:3,background:'var(--accent-soft)',color:'var(--accent-text)',cursor:'pointer',marginBottom:2,overflow:'hidden',whiteSpace:'nowrap' }}>{t.title}</div>)}
      </div>
      <div ref={timeGridRef} style={{ position:'relative',height:24*HOUR_PX }}
        onPointerDown={e => { if (e.button !== 0) return; if ((e.target as HTMLElement).closest('[data-task-block]')) return; (e.target as HTMLElement).setPointerCapture(e.pointerId); const m = yToMin(e.clientY); setDragStart(m); setDragEnd(m+30) }}
        onPointerMove={e => { if (dragStart == null) return; setDragEnd(yToMin(e.clientY)) }}
        onPointerUp={e => {
          if (dragStart == null) return
          const end = yToMin(e.clientY)
          const start = dragStart
          const s = Math.min(start, end), e2 = Math.max(start, end)
          const dur = Math.max(30, e2 - s)
          onSlotClick(date, s, s+dur)
          setDragStart(null); setDragEnd(null)
        }}>
        {date===DateU.today() && <div style={{ position:'absolute',left:0,right:0,top:cm*(HOUR_PX/60),height:2,background:'var(--p1)',zIndex:10 }}><div style={{ width:8,height:8,borderRadius:'50%',background:'var(--p1)',position:'absolute',left:-4,top:-3 }}/></div>}
        {/* drag preview */}
        {dragStart != null && dragEnd != null && (
          <div style={{ position:'absolute',left:2,right:2,top:Math.min(dragStart,dragEnd)*(HOUR_PX/60),height:Math.abs(dragEnd-dragStart)*(HOUR_PX/60),background:'var(--accent)18',border:'2px dashed var(--accent)',borderRadius:7,pointerEvents:'none',zIndex:20,padding:'4px 8px',boxSizing:'border-box',fontSize:11,color:'var(--accent)',fontWeight:600 }}>
            {String(Math.floor(Math.min(dragStart,dragEnd)/60)).padStart(2,'0')}:{String(Math.min(dragStart,dragEnd)%60).padStart(2,'0')} – {String(Math.floor(Math.max(dragStart,dragEnd)/60)).padStart(2,'0')}:{String(Math.max(dragStart,dragEnd)%60).padStart(2,'0')}
          </div>
        )}
        {timed.map(t=>{const [hh,mm]=(t.due_time||'00:00').split(':').map(Number);const top=hh*HOUR_PX+mm*(HOUR_PX/60);const endMin = t.end_time ? (()=>{const[eh,em]=t.end_time.split(':').map(Number);return eh*60+em})() : hh*60+mm+60;const h = Math.max(24, (endMin - (hh*60+mm)) * (HOUR_PX/60));return <div key={t.id} data-task-block="1" onClick={()=>onOpenTask(t.id)} style={{ position:'absolute',left:2,right:2,top,minHeight:24,height:h,background:'var(--accent-soft)',color:'var(--accent-text)',borderRadius:4,padding:'2px 4px',fontSize:11,cursor:'pointer',zIndex:1,overflow:'hidden' }}><div style={{ fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis' }}>{t.title}</div><div style={{ fontSize:10 }}>{t.due_time}{t.end_time?' – '+t.end_time:''}</div></div>})}
      </div>
    </div>
  )
}

/* ============ TimeGrid ============ */
function TimeGrid({ dates, tasks, onSlotClick, onOpenTask }: {
  dates: string[]; tasks: Task[]; onSlotClick: (date: string, startMin: number, endMin: number) => void; onOpenTask: (id: string) => void;
}) {
  return (
    <div style={{ display:'flex',flex:1,overflowY:'auto',minHeight:0 }}>
      <div style={{ width:48,flexShrink:0 }}>
        {Array.from({length:24},(_,h)=><div key={h} style={{ height:HOUR_PX,paddingRight:8,fontSize:11,color:'var(--text-tertiary)',textAlign:'right' }}>{h===0?'':`${h}:00`}</div>)}
      </div>
      {dates.map(date=><DayCol key={date} date={date} tasks={tasks.filter(t=>t.due_date===date&&!t.completed&&!t.parent_id)} onSlotClick={onSlotClick} onOpenTask={onOpenTask}/>)}
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
        <input autoFocus value={title} onChange={e=>setTitle(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&title.trim()){onCommit(title.trim());setTitle('')}if(e.key==='Escape')onCancel()}} placeholder="任务名称…" style={{ width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'8px 12px',fontSize:14,marginBottom:8,background:'var(--bg-content)',color:'var(--text-primary)',outline:'none' }}/>
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
            <MonthView year={new Date(cursor+'T00:00:00').getFullYear()} month={new Date(cursor+'T00:00:00').getMonth()} tasks={tasks} today={today} selected={selected} onSelect={setSelected} onOpenTask={setTaskModal}/>
          </div>
          <div style={{ borderLeft:'1px solid var(--border-soft)',paddingLeft:20,overflowY:'auto' }}>
            <div style={{ fontWeight:600,fontSize:14.5,marginBottom:10,color:selected===today?'var(--accent-text)':'var(--text-primary)' }}>{DateU.human(selected)} <span style={{ fontWeight:400,fontSize:12.5,color:'var(--text-tertiary)' }}>({dayTasks.length} 条)</span></div>
            <QuickComposer projectId="inbox" defaultDueDate={selected} placeholder="为这天添加任务…" autoFocus={false} onDone={fetch}/>
            {dayTasks.length===0 ? <div style={{ fontSize:13,color:'var(--text-tertiary)',paddingTop:8 }}>无任务</div> : dayTasks.map(t=><TaskRow key={t.id} task={t} showProject onClick={()=>setTaskModal(t.id)} onAIClick={task=>{setAiTask(task);setAiOpen(true)}} onDelete={fetch} onToggle={fetch}/>)}
          </div>
        </div>
      )}

      {mode==='week' && (
        <div style={{ flex:1,display:'flex',flexDirection:'column',overflow:'hidden' }}>
          <div style={{ display:'grid',gridTemplateColumns:`48px repeat(7,1fr)`,borderBottom:'1px solid var(--border-soft)',flexShrink:0 }}>
            <div/>
            {weekDates.map(date=>{const isToday=date===today;const d=new Date(date+'T00:00:00');return <div key={date} style={{ textAlign:'center',padding:'7px 4px' }}><div style={{ fontSize:11,color:'var(--text-tertiary)',marginBottom:2 }}>周{DateU.weekdayCN(date)}</div><div style={{ width:28,height:28,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',background:isToday?'var(--accent)':'transparent',color:isToday?'#fff':'var(--text-primary)',fontWeight:isToday?700:400,fontSize:14 }}>{d.getDate()}</div></div>})}
          </div>
          <TimeGrid dates={weekDates} tasks={tasks} onSlotClick={(date,startMin,endMin)=>{const pad=(n:number)=>String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');setCreateSlot({date,startTime:pad(startMin),endTime:pad(endMin)})}} onOpenTask={setTaskModal}/>
        </div>
      )}

      {createSlot && <CreatePanel slot={createSlot} onCommit={async title=>{await api.addTask({title,due_date:createSlot.date,due_time:createSlot.startTime,end_time:createSlot.endTime,project_id:'inbox'} as any);setCreateSlot(null);fetch()}} onCancel={()=>setCreateSlot(null)}/>}
      {taskModal && <TaskModal taskId={taskModal} onClose={()=>{setTaskModal(null);fetch()}}/>}
      {aiOpen && <AIPanel projectId={aiTask?.project_id||'inbox'} refTask={aiTask} layout="float" onClose={()=>setAiOpen(false)}/>}
    </div>
  )
}
