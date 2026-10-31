// These are exact queue counts, not totals inferred from the recent-record preview.
export function dashboardActions({counts={},states={},canNavigate=()=>false,can=()=>false}={}){
 const definitions=[
  ['urgent','Urgent purchases','urgent_actions','',null],
  ['po','Overdue deliveries','po','overdue',6],
  ['rfq','Overdue price requests','rfq','overdue',3],
  ['review',can('procurement.requirements.manage')?'Review shortages':'Shortages awaiting review','requirements','pending_review',2],
  ['approval',can('procurement.orders.approve')?'Approve orders':'Orders awaiting approval','po','pending_approval',6],
  ['send',can('procurement.orders.edit')?'Send approved orders':'Approved orders','po','approved',6],
  ['prices','Follow up supplier prices','rfq','',3],
  ['deliveries','Receive deliveries','receiving','',null],
  ['stockDue','Count scheduled stock','stock','due',1]
 ]
 return definitions.filter(([, ,view])=>canNavigate(view)).map(([key,label,view,filter,step])=>({key,label,view,filter,step,state:states[key]||'loading',count:Number(counts[key])||0})).filter(x=>x.state!=='ready'||x.count>0)
}
export function resumeTaskLabel(work){
 const name={stock:'stock count',requirements:'shortage review',rfq:'supplier request',po:'purchase order',receiving:'delivery entry'}[work?.view]
 return name?'Continue '+name:'Continue saved task'
}

// Three stable work lists. Counts remain separate where records can overlap.
export function dashboardWorkLists({counts={},states={},canNavigate=()=>false}={}){
 const groups=[
  {key:'review',label:'To Review',view:'requirements',filter:'all',step:2,queues:[['review','awaiting review'],...(canNavigate('urgent_actions')?[['urgent','urgent items']]:[])],hint:'Review shortages, held items and supplier setup.'},
  {key:'quotes',label:'Awaiting Quotes',view:'rfq',filter:'',step:4,queues:[['prices','requests']],hint:'Follow up requests and compare returned quotations.'},
  {key:'orders',label:'Orders',view:canNavigate('po')?'po':'receiving',filter:canNavigate('po')?'open':'',step:6,queues:canNavigate('po')?[['approval','to approve'],['send','to send'],['deliveries','awaiting delivery']]:[['deliveries','awaiting delivery']],hint:'Approve, send and track deliveries.'}
 ]
 return groups.filter(group=>canNavigate(group.view)).map(group=>{
  const state=group.queues.some(([key])=>states[key]==='error')?'error':group.queues.every(([key])=>states[key]==='ready')?'ready':'loading'
  return {...group,state,summary:state==='ready'?group.queues.map(([key,label])=>(Number(counts[key])||0)+' '+label).join(' · '):state==='error'?'Unavailable · tap to retry':'Loading…'}
 })
}
