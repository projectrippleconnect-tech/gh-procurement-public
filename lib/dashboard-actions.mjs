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
