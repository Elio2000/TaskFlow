/* calendar.jsx — 日/周/月 + 任务碰撞布局 + 右侧拖拽创建面板 */
const { useState, useEffect, useRef, useMemo } = React;

/* ============ 工具 ============ */
const CalUtil = {
  pad:(n)=>String(n).padStart(2,'0'),
  fmt(d){return d.getFullYear()+'-'+this.pad(d.getMonth()+1)+'-'+this.pad(d.getDate());},
  fmtTime(h,m){return this.pad(h%24)+':'+this.pad(m%60);},
  parse(s){return new Date(s+'T00:00:00');},
  today(){return this.fmt(new Date());},
  addDays(s,n){const d=this.parse(s);d.setDate(d.getDate()+n);return this.fmt(d);},
  weekStart(s){const d=this.parse(s);const w=d.getDay()===0?7:d.getDay();d.setDate(d.getDate()-w+1);return this.fmt(d);},
  monthGrid(y,m){
    const first=new Date(y,m,1),offset=first.getDay()===0?6:first.getDay()-1;
    return Array.from({length:6},(_,w)=>Array.from({length:7},(_,d)=>{
      const day=new Date(y,m,1-offset+w*7+d);
      return{date:this.fmt(day),day:day.getDate(),inMonth:day.getMonth()===m};
    }));
  },
  snap(min,step=15){return Math.round(min/step)*step;},
  minToTime(min){const m=((min%1440)+1440)%1440;return this.fmtTime(Math.floor(m/60),m%60);},
  timeToMin(s){if(!s)return 0;const[h,m]=s.split(':').map(Number);return h*60+m;},
  isSpan(t){return!!(t.start_date&&t.due_date&&t.start_date!==t.due_date);},
  taskS(t){return t.start_date||t.due_date;},
  taskE(t){return t.due_date;},
  overlaps(t,rs,re){const s=this.taskS(t),e=this.taskE(t);return!!(s&&e&&s<=re&&e>=rs);},
};

const HOUR_H = 56;

/* ===== 碰撞布局算法 ===== */
function layoutTimedTasks(tasks) {
  const items = tasks.map(t => ({
    task: t,
    start: CalUtil.timeToMin(t.due_time),
    end: t.end_time ? CalUtil.timeToMin(t.end_time) : CalUtil.timeToMin(t.due_time) + 45,
  })).sort((a,b) => a.start - b.start);

  const cols = []; // cols[i] = last end time in that column
  const placed = items.map(item => {
    let ci = cols.findIndex(end => end <= item.start);
    if (ci === -1) { ci = cols.length; cols.push(0); }
    cols[ci] = item.end;
    return { ...item, ci };
  });

  // Second pass: find how many cols overlap at each task's time range
  return placed.map(item => {
    const concurrent = placed.filter(o => o.start < item.end && o.end > item.start);
    const numCols = concurrent.length > 0 ? Math.max(...concurrent.map(o => o.ci)) + 1 : 1;
    return { ...item, numCols };
  });
}

/* ============ 视图切换 ============ */
function CalSwitcher({value,onChange}){
  return(
    <div style={{display:'flex',background:'var(--bg-inset)',borderRadius:9,padding:3,gap:2}}>
      {[['day','日'],['week','周'],['month','月']].map(([v,l])=>(
        <button key={v} onClick={()=>onChange(v)} style={{fontSize:13,padding:'4px 12px',borderRadius:7,border:'none',cursor:'pointer',
          background:value===v?'var(--bg-card)':'transparent',color:value===v?'var(--text-primary)':'var(--text-tertiary)',
          fontWeight:value===v?600:400,fontFamily:'var(--font)',
          boxShadow:value===v?'0 1px 3px rgba(0,0,0,.08)':'none',transition:'all .12s'}}>{l}</button>
      ))}
    </div>
  );
}

/* ============ 月视图 ============ */
function MonthView({year,month,tasks,onOpenTask,onDateClick}){
  const today=CalUtil.today();
  const weeks=CalUtil.monthGrid(year,month);
  const spanTasks=tasks.filter(t=>CalUtil.isSpan(t)&&!t.completed);
  const singleMap={};
  tasks.filter(t=>!CalUtil.isSpan(t)&&!t.completed&&t.due_date).forEach(t=>{
    (singleMap[t.due_date]||(singleMap[t.due_date]=[])).push(t);
  });
  return(
    <div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',borderBottom:'1px solid var(--border-soft)'}}>
        {['一','二','三','四','五','六','日'].map(w=>(
          <div key={w} style={{textAlign:'center',fontSize:12,color:'var(--text-tertiary)',padding:'7px 0',fontWeight:500}}>{w}</div>
        ))}
      </div>
      {weeks.map((week,wi)=>{
        const ws=week[0].date,we=week[6].date;
        const rowSpans=spanTasks.filter(t=>CalUtil.overlaps(t,ws,we));
        return(
          <div key={wi} style={{borderBottom:'1px solid var(--border-soft)'}}>
            {rowSpans.length>0&&(
              <div style={{position:'relative',height:rowSpans.length*22+4,margin:'2px 0'}}>
                {rowSpans.map((task,ti)=>{
                  const s=CalUtil.taskS(task),e=CalUtil.taskE(task);
                  const cs=s<ws?ws:s,ce=e>we?we:e;
                  const si=week.findIndex(c=>c.date===cs),ei=week.findIndex(c=>c.date===ce);
                  if(si<0||ei<0)return null;
                  const proj=DB.project(task.project_id);
                  const color=proj?proj.color:'var(--accent)';
                  const rl=s>=ws,rr=e<=we;
                  return(
                    <div key={task.id} onClick={ev=>{ev.stopPropagation();onOpenTask(task);}}
                      style={{position:'absolute',top:ti*22+2,height:20,
                        left:`calc(${si/7*100}% + 2px)`,width:`calc(${(ei-si+1)/7*100}% - 4px)`,
                        background:color+'22',border:'1px solid '+color+'55',
                        borderRadius:`${rl?5:0}px ${rr?5:0}px ${rr?5:0}px ${rl?5:0}px`,
                        cursor:'pointer',display:'flex',alignItems:'center',paddingLeft:rl?7:3,
                        fontSize:11.5,color,fontWeight:500,overflow:'hidden',whiteSpace:'nowrap',zIndex:1}}>
                      {rl&&<><span style={{width:6,height:6,borderRadius:'50%',background:color,flex:'none',marginRight:4}}></span>{task.title}</>}
                      {!rl&&'›'}
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)'}}>
              {week.map(cell=>{
                const isToday=cell.date===today;
                const singles=(singleMap[cell.date]||[]).slice(0,3);
                const extra=(singleMap[cell.date]||[]).length-3;
                return(
                  <div key={cell.date} onClick={()=>onDateClick(cell.date)}
                    style={{padding:'4px 6px 6px',minHeight:64,borderRight:'1px solid var(--border-soft)',cursor:'pointer',transition:'background .1s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-hover)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12.5,marginBottom:3,
                      background:isToday?'var(--accent)':'transparent',
                      color:isToday?'#fff':cell.inMonth?'var(--text-primary)':'var(--text-tertiary)',
                      fontWeight:isToday?700:400}}>{cell.day}</div>
                    {singles.map(t=>(
                      <div key={t.id} onClick={e=>{e.stopPropagation();onOpenTask(t);}}
                        style={{fontSize:11,lineHeight:1.3,padding:'2px 4px',borderRadius:4,marginBottom:2,
                          background:'var(--bg-inset)',color:'var(--text-secondary)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',cursor:'pointer'}}>
                        <span style={{width:5,height:5,borderRadius:'50%',background:PRIORITY_META[t.priority].color,display:'inline-block',marginRight:3}}></span>{t.title}
                      </div>
                    ))}
                    {extra>0&&<div style={{fontSize:10.5,color:'var(--text-tertiary)',paddingLeft:4}}>+{extra}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============ 日列（Pointer Capture 拖拽）============ */
function DayCol({date,tasks,onOpenTask,drag,setDrag,scrollRef}){
  const today=CalUtil.today();
  const isToday=date===today;
  const colRef=useRef(null);
  const now=new Date();
  const nowTop=(now.getHours()+now.getMinutes()/60)*HOUR_H;

  const yToMin=clientY=>{
    const cr=colRef.current,sr=scrollRef.current;
    if(!cr||!sr)return 0;
    const rect=cr.getBoundingClientRect();
    const raw=(clientY-rect.top)/HOUR_H*60;
    return CalUtil.snap(Math.max(0,Math.min(23*60+45,raw)));
  };

  const onPointerDown=e=>{
    if(e.button!==0||e.target.closest('[data-task-block]'))return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const min=yToMin(e.clientY);
    setDrag({date,startMin:min,endMin:min+60,creating:false});
  };
  const onPointerMove=e=>{
    if(!drag||drag.date!==date||drag.creating)return;
    const min=yToMin(e.clientY);
    if(min>drag.startMin+14)setDrag(d=>({...d,endMin:min}));
  };
  const onPointerUp=e=>{
    if(!drag||drag.date!==date)return;
    if(drag.endMin-drag.startMin>=15)setDrag(d=>({...d,creating:true}));
    else setDrag(null);
  };

  /* 碰撞布局 */
  const timed=tasks.filter(t=>t.due_date===date&&t.due_time&&!t.completed);
  const laid=layoutTimedTasks(timed);

  return(
    <div ref={colRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
      style={{position:'relative',borderLeft:'1px solid var(--border-soft)',height:24*HOUR_H,cursor:'crosshair',userSelect:'none'}}>
      {isToday&&(
        <div style={{position:'absolute',top:nowTop,left:0,right:0,height:2,background:'var(--accent)',zIndex:10,pointerEvents:'none'}}>
          <div style={{position:'absolute',left:-4,top:-4,width:10,height:10,borderRadius:'50%',background:'var(--accent)'}}></div>
        </div>
      )}
      {laid.map(({task:t,start,end,ci,numCols})=>{
        const top=start/60*HOUR_H;
        const height=Math.max(22,(end-start)/60*HOUR_H);
        const w=100/numCols;
        const proj=DB.project(t.project_id);
        const color=proj?proj.color:PRIORITY_META[t.priority].color;
        return(
          <div key={t.id} data-task-block="1"
            onClick={e=>{e.stopPropagation();onOpenTask(t);}}
            style={{position:'absolute',top,height,
              left:`calc(${ci*w}% + 2px)`,width:`calc(${w}% - 3px)`,
              background:color+'28',border:'1.5px solid '+color+'90',borderRadius:7,
              padding:'3px 6px',cursor:'pointer',zIndex:5,overflow:'hidden',boxSizing:'border-box',
              fontSize:11.5,color,fontWeight:500,lineHeight:1.3}}>
            <div style={{fontSize:10.5,opacity:.75,whiteSpace:'nowrap'}}>{CalUtil.minToTime(start)}{end-start!==45?' – '+CalUtil.minToTime(end):''}</div>
            <div style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.title}</div>
          </div>
        );
      })}
      {/* 拖拽预览 */}
      {drag&&drag.date===date&&!drag.creating&&(
        <div style={{position:'absolute',top:drag.startMin/60*HOUR_H,left:2,right:2,
          height:Math.max(22,(drag.endMin-drag.startMin)/60*HOUR_H),
          background:'var(--accent)18',border:'2px dashed var(--accent)',borderRadius:7,
          pointerEvents:'none',zIndex:20,padding:'4px 8px',boxSizing:'border-box',
          fontSize:11.5,color:'var(--accent)',fontWeight:600,lineHeight:1.4}}>
          <div>{CalUtil.minToTime(drag.startMin)} – {CalUtil.minToTime(drag.endMin)}</div>
        </div>
      )}
    </div>
  );
}

/* ============ 右侧创建面板（Notion 风格）============ */
function CreatePanel({drag,onCommit,onCancel}){
  const [title,setTitle]=useState('');
  const [projectId,setProjectId]=useState('inbox');
  const [allDay,setAllDay]=useState(false);
  const inputRef=useRef(null);
  useEffect(()=>{if(inputRef.current)inputRef.current.focus();},[]);
  if(!drag)return null;
  const projects=DB.projects();
  const submit=()=>{
    if(!title.trim())return;
    onCommit({
      title:title.trim(), project_id:projectId,
      due_date:drag.date,
      due_time:allDay?null:CalUtil.minToTime(drag.startMin),
      end_time:allDay?null:CalUtil.minToTime(drag.endMin),
      priority:4,
    });
  };
  return(
    <div style={{width:300,flexShrink:0,borderLeft:'1px solid var(--border-soft)',background:'var(--bg-card)',
      display:'flex',flexDirection:'column',animation:'pop-in .14s ease-out',overflowY:'auto'}}>
      <div style={{padding:'16px 18px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <span style={{fontSize:13,fontWeight:600,color:'var(--text-secondary)'}}>新建任务</span>
        <button className="btn-icon" onClick={onCancel}><Icon name="x" size={15}/></button>
      </div>
      <div style={{padding:'12px 18px',flex:1}}>
        <input ref={inputRef} value={title} onChange={e=>setTitle(e.target.value)}
          onKeyDown={e=>{if(e.key==='Enter')submit();if(e.key==='Escape')onCancel();}}
          placeholder="任务标题"
          style={{width:'100%',border:'none',borderBottom:'2px solid var(--border)',background:'none',
            fontSize:16,fontWeight:600,color:'var(--text-primary)',outline:'none',padding:'4px 0 8px',
            marginBottom:16,fontFamily:'var(--font)',boxSizing:'border-box'}}/>

        {/* 时间区域 */}
        <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12,padding:'8px 10px',
          background:'var(--bg-inset)',borderRadius:9}}>
          <Icon name="clock" size={15} style={{color:'var(--text-tertiary)',flex:'none'}}/>
          <div style={{flex:1}}>
            <div style={{fontSize:12.5,color:'var(--text-secondary)',marginBottom:2}}>
              {allDay?'全天': CalUtil.minToTime(drag.startMin)+' → '+CalUtil.minToTime(drag.endMin)}
            </div>
            <div style={{fontSize:12,color:'var(--text-tertiary)'}}>{DateU.human(drag.date)}</div>
          </div>
          <button onClick={()=>setAllDay(a=>!a)}
            style={{fontSize:11,padding:'2px 8px',borderRadius:5,border:'1px solid var(--border)',
              background:allDay?'var(--accent-soft)':'var(--bg-card)',color:allDay?'var(--accent-text)':'var(--text-tertiary)',cursor:'pointer',fontFamily:'var(--font)'}}>
            {allDay?'定时':'全天'}
          </button>
        </div>

        {/* 项目 */}
        <div style={{marginBottom:12}}>
          <div style={{fontSize:12,color:'var(--text-tertiary)',marginBottom:5}}>项目</div>
          <select value={projectId} onChange={e=>setProjectId(e.target.value)}
            style={{width:'100%',border:'1px solid var(--border)',borderRadius:8,padding:'6px 10px',
              fontSize:13,background:'var(--bg-content)',color:'var(--text-primary)',outline:'none',fontFamily:'var(--font)'}}>
            {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div style={{display:'flex',gap:8,marginTop:8}}>
          <button className="btn-primary" style={{flex:1}} onClick={submit} disabled={!title.trim()}>创建</button>
          <button className="btn-outline" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}

/* ============ 时间网格容器 ============ */
function TimeGrid({dates,tasks,onOpenTask}){
  const today=CalUtil.today();
  const scrollRef=useRef(null);
  const [drag,setDrag]=useState(null);
  const [,tick]=useState(0);
  useEffect(()=>DB.subscribe(()=>tick(n=>n+1)),[]);
  const now=new Date();
  const nowTop=(now.getHours()+now.getMinutes()/60)*HOUR_H;
  useEffect(()=>{if(scrollRef.current)scrollRef.current.scrollTop=Math.max(0,nowTop-120);},[]);

  const ws=dates[0],we=dates[dates.length-1];
  const spanTasks=tasks.filter(t=>!t.completed&&CalUtil.isSpan(t)&&CalUtil.overlaps(t,ws,we));
  const allDayTasks=tasks.filter(t=>!t.completed&&!t.due_time&&!CalUtil.isSpan(t)&&t.due_date&&t.due_date>=ws&&t.due_date<=we);
  const hasAllDay=spanTasks.length>0||allDayTasks.length>0;

  const allDayRows=Math.max(spanTasks.length,1);

  const commitCreate=fields=>{
    DB.addTask({priority:4,...fields});
    setDrag(null);
  };

  return(
    <div style={{display:'flex',flex:1,minHeight:0,overflow:'hidden'}}>
      {/* 左：时间轴 */}
      <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>
        {/* 列头 */}
        <div style={{display:'grid',gridTemplateColumns:`48px repeat(${dates.length},1fr)`,borderBottom:'1px solid var(--border-soft)',flexShrink:0}}>
          <div></div>
          {dates.map(date=>{
            const isToday=date===today;
            const d=CalUtil.parse(date);
            return(
              <div key={date} style={{textAlign:'center',padding:'7px 4px'}}>
                <div style={{fontSize:11,color:'var(--text-tertiary)',marginBottom:2}}>周{DateU.weekdayCN(date)}</div>
                <div style={{width:28,height:28,borderRadius:'50%',margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'center',
                  background:isToday?'var(--accent)':'transparent',color:isToday?'#fff':'var(--text-primary)',
                  fontWeight:isToday?700:400,fontSize:14}}>{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* 全天区 */}
        {hasAllDay&&(
          <div style={{display:'grid',gridTemplateColumns:`48px repeat(${dates.length},1fr)`,borderBottom:'1px solid var(--border-soft)',flexShrink:0,minHeight:allDayRows*22+10}}>
            <div style={{fontSize:11,color:'var(--text-tertiary)',textAlign:'right',paddingRight:5,paddingTop:6}}>全天</div>
            <div style={{gridColumn:`2/${dates.length+2}`,position:'relative',padding:'3px 0'}}>
              {spanTasks.map((task,ti)=>{
                const s=CalUtil.taskS(task),e=CalUtil.taskE(task);
                const cs=s<ws?ws:s,ce=e>we?we:e;
                const si=dates.indexOf(cs),ei=dates.indexOf(ce);
                if(si<0||ei<0)return null;
                const proj=DB.project(task.project_id);
                const color=proj?proj.color:'var(--accent)';
                return(
                  <div key={task.id} data-task-block="1" onClick={()=>onOpenTask(task)}
                    style={{position:'absolute',top:ti*22+2,height:20,
                      left:`calc(${si/dates.length*100}% + 2px)`,width:`calc(${(ei-si+1)/dates.length*100}% - 4px)`,
                      background:color+'22',border:'1px solid '+color+'55',borderRadius:5,
                      cursor:'pointer',display:'flex',alignItems:'center',paddingLeft:7,
                      fontSize:11.5,color,fontWeight:500,overflow:'hidden',whiteSpace:'nowrap',zIndex:2}}>
                    <span style={{width:5,height:5,borderRadius:'50%',background:color,flex:'none',marginRight:4}}></span>
                    {task.title}
                  </div>
                );
              })}
              {allDayTasks.map(t=>{
                const ci=dates.indexOf(t.due_date);if(ci<0)return null;
                const proj=DB.project(t.project_id);
                const color=proj?proj.color:PRIORITY_META[t.priority].color;
                const rowOff=spanTasks.length*22+4;
                return(
                  <div key={t.id} data-task-block="1" onClick={()=>onOpenTask(t)}
                    style={{position:'absolute',top:rowOff,height:20,
                      left:`calc(${ci/dates.length*100}% + 2px)`,width:`calc(${1/dates.length*100}% - 4px)`,
                      background:color+'18',border:'1px solid '+color+'40',borderRadius:5,
                      cursor:'pointer',display:'flex',alignItems:'center',paddingLeft:6,
                      fontSize:11,color,overflow:'hidden',whiteSpace:'nowrap'}}>
                    {t.title}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 时间轴 */}
        <div ref={scrollRef} style={{flex:1,overflowY:'auto'}}>
          <div style={{display:'grid',gridTemplateColumns:`48px repeat(${dates.length},1fr)`,height:24*HOUR_H,position:'relative'}}>
            {Array.from({length:24},(_,h)=>(
              <React.Fragment key={h}>
                <div style={{position:'absolute',top:h*HOUR_H-8,left:0,width:42,textAlign:'right',fontSize:11,color:'var(--text-tertiary)',paddingRight:5,pointerEvents:'none'}}>
                  {h===0?'':h+':00'}
                </div>
                <div style={{position:'absolute',top:h*HOUR_H,left:48,right:0,height:1,background:'var(--border-soft)',pointerEvents:'none'}}></div>
              </React.Fragment>
            ))}
            {dates.map((date,ci)=>(
              <div key={date} style={{gridColumn:ci+2}}>
                <DayCol date={date} tasks={tasks} onOpenTask={onOpenTask}
                  drag={drag} setDrag={setDrag} scrollRef={scrollRef}/>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 右：Notion 风格创建面板 */}
      {drag?.creating&&(
        <CreatePanel drag={drag} onCommit={commitCreate} onCancel={()=>setDrag(null)}/>
      )}
    </div>
  );
}

/* ============ 主 CalendarView ============ */
function CalendarView({onOpenTask}){
  const [,tick]=useState(0);
  useEffect(()=>DB.subscribe(()=>tick(n=>n+1)),[]);
  const [calView,setCalView]=useState('month');
  const [anchor,setAnchor]=useState(()=>new Date());
  const allTasks=DB.tasks(t=>!t.parent_id);

  const navigate=dir=>{setAnchor(prev=>{const d=new Date(prev);
    if(calView==='day')d.setDate(d.getDate()+dir);
    else if(calView==='week')d.setDate(d.getDate()+dir*7);
    else d.setMonth(d.getMonth()+dir);return d;});};

  const title=useMemo(()=>{
    if(calView==='month')return anchor.getFullYear()+'年'+(anchor.getMonth()+1)+'月';
    if(calView==='week'){
      const ws=CalUtil.weekStart(CalUtil.fmt(anchor)),we=CalUtil.addDays(ws,6);
      const sd=CalUtil.parse(ws),ed=CalUtil.parse(we);
      return sd.getMonth()===ed.getMonth()?sd.getFullYear()+'年'+(sd.getMonth()+1)+'月':(sd.getMonth()+1)+'–'+(ed.getMonth()+1)+'月';
    }
    return anchor.getFullYear()+'年'+(anchor.getMonth()+1)+'月'+anchor.getDate()+'日 周'+DateU.weekdayCN(CalUtil.fmt(anchor));
  },[anchor,calView]);

  const weekDates=useMemo(()=>{const ws=CalUtil.weekStart(CalUtil.fmt(anchor));return Array.from({length:7},(_,i)=>CalUtil.addDays(ws,i));},[anchor]);
  const handleDateClick=date=>{setAnchor(CalUtil.parse(date));setCalView('day');};
  const actions=(
    <div style={{display:'flex',alignItems:'center',gap:8}}>
      <CalSwitcher value={calView} onChange={setCalView}/>
      <div style={{display:'flex',gap:2}}>
        <button className="btn-icon" onClick={()=>navigate(-1)}><Icon name="chevronLeft" size={15}/></button>
        <button className="btn-ghost" style={{fontSize:12.5}} onClick={()=>setAnchor(new Date())}>今天</button>
        <button className="btn-icon" onClick={()=>navigate(1)}><Icon name="chevronRight" size={15}/></button>
      </div>
    </div>
  );
  return(
    <ViewShell title={title} actions={actions}>
      {calView==='month'&&<MonthView year={anchor.getFullYear()} month={anchor.getMonth()} tasks={allTasks} onOpenTask={onOpenTask} onDateClick={handleDateClick}/>}
      {(calView==='week'||calView==='day')&&<TimeGrid dates={calView==='week'?weekDates:[CalUtil.fmt(anchor)]} tasks={allTasks} onOpenTask={onOpenTask}/>}
    </ViewShell>
  );
}
Object.assign(window,{CalendarView});
