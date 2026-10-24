'use client'
import {useEffect,useRef,useState} from 'react'
import {supabase} from '@/lib/supabase'
import {changedWork,reminderDue} from '@/lib/work-notifications.mjs'
import {usePopup} from './popup-messages'
export function WorkNotifications({userId,canNavigate,navigate}){
 const notify=usePopup(),latest=useRef({canNavigate,navigate})
 latest.current={canNavigate,navigate}
 const [items,setItems]=useState([]),[open,setOpen]=useState(false),[unavailable,setUnavailable]=useState(false)
 const scope=['rfq','po','requirements'].filter(canNavigate).join(',')
 useEffect(()=>{
  let stopped=false,running=false
  const snapshots={},seen=new Set(),reminded={}
  const storageKey=`gh-work-reminders:${userId}`
  try{Object.assign(reminded,JSON.parse(localStorage.getItem(storageKey)||'{}'))}catch{}
  setItems([]);setOpen(false)
  const add=(event,popup=true)=>{
   if(stopped||!latest.current.canNavigate(event.view)||seen.has(event.key))return
   seen.add(event.key)
   if(seen.size>1000)seen.delete(seen.values().next().value)
   const item={...event,at:Date.now(),read:false}
   setItems(rows=>[item,...rows].slice(0,50))
   if(popup)notify({...event,onOpen:()=>{latest.current.navigate(event.view,event.filter||'');setItems(rows=>rows.map(x=>x.key===event.key?{...x,read:true}:x))}})
  }
  async function poll(){
   if(stopped||running||document.visibilityState==='hidden'||!navigator.onLine)return
   running=true
   let failed=false
   try{
    const definitions=[['rfq','proc_rfqs','id,rfq_no,status,created_at,updated_at','updated_at','rfq'],['po','proc_purchase_orders','id,po_no,status,created_at,updated_at','updated_at','po'],['reply','proc_rfq_suppliers','id,rfq_id,status,replied_at','replied_at','rfq']]
    for(const [type,table,fields,order,view] of definitions){
     if(!latest.current.canNavigate(view))continue
     const result=await supabase.from(table).select(fields).order(order,{ascending:false,nullsFirst:false}).limit(200)
     if(stopped)return
     if(result.error){failed=true;continue}
     const {next,events}=changedWork(snapshots[type],result.data||[],type)
     snapshots[type]=next
     events.forEach(event=>add(event))
    }
    const queues=[['approval','po','proc_purchase_orders','status','pending_approval','Orders need approval'],['send','po','proc_purchase_orders','status','approved','Approved orders are ready to send'],['review','requirements','proc_requirements','approval_status','pending_review','Stock shortages need review'],['overdue','rfq','proc_rfqs','status','overdue','Supplier price requests are overdue']]
    for(const [key,view,table,column,status,text] of queues){
     if(!latest.current.canNavigate(view))continue
     let query=supabase.from(table).select('id',{count:'exact',head:true})
     if(key==='overdue')query=query.in('status',['sent','partially_quoted']).lt('due_date',new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()))
     else query=query.eq(column,status)
     const result=await query
     if(stopped)return
     if(result.error){failed=true;continue}
     if(!result.count){setItems(rows=>rows.filter(x=>x.queue!==key));continue}
     const event={key:`reminder:${key}`,queue:key,kind:'reminder',text:`${text}: ${result.count}. Finish the pending step.`,view,filter:status}
     setItems(rows=>{
      const old=rows.find(x=>x.key===event.key)
      return [{...event,at:old?.at||Date.now(),read:old?.text===event.text?old.read:false},...rows.filter(x=>x.key!==event.key)].slice(0,50)
     })
     if(reminderDue(Number(reminded[key]),Date.now())){
      reminded[key]=Date.now()
      try{localStorage.setItem(storageKey,JSON.stringify(reminded))}catch{}
      notify({...event,onOpen:()=>latest.current.navigate(view,status)})
     }
    }
    if(!stopped)setUnavailable(failed)
   }catch{if(!stopped)setUnavailable(true)}finally{running=false}
  }
  poll()
  const timer=setInterval(poll,30000)
  window.addEventListener('online',poll);document.addEventListener('visibilitychange',poll)
  return()=>{stopped=true;notify({clear:true});clearInterval(timer);window.removeEventListener('online',poll);document.removeEventListener('visibilitychange',poll)}
 },[userId,scope,notify])
 const visible=items.filter(x=>canNavigate(x.view)),unread=visible.filter(x=>!x.read).length
 return <div className="work-notifications"><button className="btn small notification-trigger" aria-label={`Notifications, ${unread} unread`} aria-expanded={open} onClick={()=>{notify({clear:true});setOpen(!open)}}><svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>{unread>0&&<span className="notification-count">{unread}</span>}</button>{open&&<section className="notification-panel" aria-label="Notification centre"><div className="toolbar"><strong>Notifications</strong><button className="btn small" onClick={()=>setItems(rows=>rows.map(x=>({...x,read:true})))}>Mark read</button><button className="btn small" aria-label="Close notifications" onClick={()=>setOpen(false)}>×</button></div><p className="muted tiny">Updates while the app is open. Pending work is checked every 30 seconds.</p>{unavailable&&<p role="status">Some updates are unavailable. Retrying automatically.</p>}{!visible.length&&<p>No new updates yet.</p>}{visible.map(item=><button key={item.key} className={'notification-item '+(!item.read?'unread':'')} onClick={()=>{navigate(item.view,item.filter||'');setOpen(false);setItems(rows=>rows.map(x=>x.key===item.key?{...x,read:true}:x))}}><span>{item.text}</span><small>{new Date(item.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} · Open task →</small></button>)}</section>}</div>
}
