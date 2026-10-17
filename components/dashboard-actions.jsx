'use client'
import {useState} from 'react'
import {dashboardActions,resumeTaskLabel} from '@/lib/dashboard-actions.mjs'

export function DashboardActions({counts,states,canNavigate,can,navigate,onRefresh,lastWork,resumeWork}){
 const [expanded,setExpanded]=useState(false)
 const tasks=dashboardActions({counts,states,canNavigate,can})
 const shown=expanded?tasks:tasks.slice(0,4)
 return <section className="card pad dashboard-next" aria-labelledby="dashboard-next-title">
  <div className="sectionhead"><h3 id="dashboard-next-title">Needs your attention</h3><button className="btn small" onClick={onRefresh}>Refresh tasks</button></div>
  {lastWork&&canNavigate(lastWork.view)&&<button className="dashboard-resume btn primary" onClick={resumeWork}><strong>{resumeTaskLabel(lastWork)}</strong><span aria-hidden="true">→</span></button>}
  {tasks.length===0?<p role="status">No pending tasks in your available work queues.</p>:<div className="dashboard-task-list">{shown.map(task=><button key={task.key} className="dashboard-task btn" disabled={task.state==='loading'} onClick={()=>task.state==='error'?onRefresh():navigate(task.view,task.filter,task.step)}><span><strong>{task.label}</strong>{task.state==='error'&&<small>Could not load · tap to retry</small>}</span><span className="dashboard-task-count">{task.state==='ready'?task.count:task.state==='error'?'Retry':'…'}</span><span aria-hidden="true">→</span></button>)}</div>}
  {tasks.length>4&&<button className="btn small section" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}>{expanded?'Show fewer tasks':`All ${tasks.length} task groups`}</button>}
 </section>
}
