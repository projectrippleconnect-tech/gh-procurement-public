export const WORK_VIEWS=Object.freeze(['Needs me','In progress','History'])
export const ORDER_STATES=Object.freeze({draft:'Draft exists',pending_approval:'Awaiting approval',approved:'Approved — not sent',sent:'Ordered — awaiting delivery',partially_received:'Part received',received:'Received',closed:'Closed',cancelled:'Cancelled'})
const finished=new Set(['received','closed','cancelled'])
export function purchasingCase(row,{can=()=>false,canNavigate=()=>false}={}){
 const documents=row.proc_work_documents||{rfqs:[],orders:[]}
 const rfqs=documents.rfqs||[],orders=documents.orders||[],receipts=documents.receipts||[]
 const activeQuotes=rfqs.filter(q=>['draft','prepared','sent','partially_quoted','quoted'].includes(q.status))
 const liveOrders=orders.filter(p=>!finished.has(p.status)&&Number(p.remaining)>0)
 const stillBuy=Math.max(0,Number(row.remaining_to_order)||0)
 const stillReceive=liveOrders.filter(p=>['sent','partially_received'].includes(p.status)).reduce((n,p)=>n+Number(p.remaining),0)
 const reserved=liveOrders.filter(p=>['draft','pending_approval','approved'].includes(p.status)).reduce((n,p)=>n+Number(p.remaining),0)
 const history=(finished.has(row.status)||row.approval_status==='rejected')&&liveOrders.length===0
 const actions=[]
 const add=(label,view,filter,permission)=>{if(canNavigate(view)&&can(permission))actions.push({label,view,filter})}
 if(!history){
  if(['held','pending_review'].includes(row.approval_status))add(row.approval_status==='held'?'Review hold':'Review quantity','requirements','requirement:'+row.id,'procurement.requirements.manage')
  else if(stillBuy>0&&!activeQuotes.length)add('Assign supplier','requirements','requirement:'+row.id,'procurement.requirements.manage')
  for(const q of (row.approval_status==='approved'&&stillBuy>0?activeQuotes:[])){
   if(q.status==='quoted')add('Compare prices','rfq',q.id,'procurement.rfq.manage')
   else if(['draft','prepared'].includes(q.status))add('Prepare supplier request','rfq',q.id,'procurement.rfq.manage')
   else add('Follow up prices','rfq',q.id,'procurement.rfq.manage')
  }
  for(const p of liveOrders){
   if(row.approval_status!=='approved'&&['draft','pending_approval','approved'].includes(p.status))continue
   if(p.status==='pending_approval')add(p.quantity_only?'Approve quantity':'Approve order','po',p.id,'procurement.orders.approve')
   else if(p.status==='approved')add('Send order','po',p.id,'procurement.orders.edit')
   else if(p.status==='draft')add('Review draft','po',p.id,'procurement.orders.edit')
   else if(['sent','partially_received'].includes(p.status))add('Record delivery','receiving',p.id,'receiving.manage')
  }
 }
 const unique=actions.filter((a,i)=>actions.findIndex(b=>a.label===b.label&&a.view===b.view&&a.filter===b.filter)===i)
 return {id:row.id,row,rfqs,orders,receipts,stillBuy,stillReceive,reserved,history,actions:unique,tab:history?'History':unique.length?'Needs me':'In progress'}
}
