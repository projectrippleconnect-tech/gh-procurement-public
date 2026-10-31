export const WORK_VIEWS=Object.freeze(['Needs me','In progress','History'])
export const ORDER_STATES=Object.freeze({draft:'Draft exists',pending_approval:'Awaiting approval',approved:'Approved — not sent',sent:'Ordered — awaiting delivery',partially_received:'Part received',received:'Received',closed:'Closed',cancelled:'Cancelled'})
const finished=new Set(['received','closed','cancelled'])
export function purchasingCase(row,{can=()=>false,canNavigate=()=>false}={}){
 const documents=row.proc_work_documents||{rfqs:[],orders:[]}
 const rfqs=documents.rfqs||[],orders=documents.orders||[],receipts=documents.receipts||[]
 const activeQuotes=rfqs.filter(q=>['draft','prepared','sent','partially_quoted','quoted'].includes(q.status))
 const liveOrders=orders.filter(p=>!finished.has(p.status)&&Number(p.remaining)>0)
 const stillBuy=Math.max(0,Number(row.remaining_to_order)||0)
 const stillReceive=documents.still_receive!==undefined?Math.max(0,Number(documents.still_receive)||0):liveOrders.filter(p=>['sent','partially_received'].includes(p.status)).reduce((n,p)=>n+Number(p.remaining),0)
 const reserved=liveOrders.filter(p=>['draft','pending_approval','approved'].includes(p.status)).reduce((n,p)=>n+Number(p.remaining),0)
 const history=(finished.has(row.status)||row.approval_status==='rejected')&&liveOrders.length===0
 const actions=[]
 const today=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Colombo'})
 const add=(label,view,filter,permission,due='')=>{if(canNavigate(view)&&can(permission))actions.push({label,view,filter,overdue:!!due&&due<today})}
 if(!history){
  if(['held','pending_review'].includes(row.approval_status))add(row.approval_status==='held'?'Review hold':'Review quantity','requirements','requirement:'+row.id,'procurement.requirements.manage')
  else if(stillBuy>0&&!activeQuotes.length)add('Assign supplier','requirements','requirement:'+row.id,'procurement.requirements.manage')
  for(const q of (row.approval_status==='approved'&&stillBuy>0?activeQuotes:[])){
   if(['quoted','partially_quoted'].includes(q.status))add('Compare prices','rfq',q.id,'procurement.rfq.manage')
   else if(['draft','prepared'].includes(q.status))add('Prepare supplier request','rfq',q.id,'procurement.rfq.manage')
   else add('Follow up prices','rfq',q.id,'procurement.rfq.manage',q.due_date)
  }
  for(const p of liveOrders){
   if(row.approval_status!=='approved'&&['draft','pending_approval','approved'].includes(p.status))continue
   if(p.status==='pending_approval')add(p.quantity_only?'Approve quantity':'Approve order','po',p.id,'procurement.orders.approve')
   else if(p.status==='approved')add('Send order','po',p.id,'procurement.orders.edit')
   else if(p.status==='draft')add('Review draft','po',p.id,'procurement.orders.edit')
   else if(['sent','partially_received'].includes(p.status))add('Record delivery','receiving',p.id,'receiving.manage',p.expected_date)
  }
 }
 const unique=actions.filter((a,i)=>actions.findIndex(b=>a.label===b.label&&a.view===b.view&&a.filter===b.filter)===i)
 const rank={'Review hold':0,'Review quantity':1,'Approve quantity':20,'Approve order':20,'Send order':30,'Compare prices':40,'Review draft':50,'Prepare supplier request':50,'Assign supplier':60,'Record delivery':70,'Follow up prices':80}
 const ranked=unique.toSorted((a,b)=>(a.overdue?10:rank[a.label]??90)-(b.overdue?10:rank[b.label]??90))
 const primaryAction=ranked[0]||null
 const secondaryAction=primaryAction?.view==='receiving'?ranked.find(a=>a.view!=='receiving'):ranked.find(a=>a.view==='receiving')
 const attention=row.approval_status==='held'?row.hold_reason||'Review the hold before purchasing.':ranked.some(a=>a.overdue)?'An outstanding supplier response or delivery is overdue.':row.customer_paid?'Customer-paid purchase. Prioritise this requirement.':row.priority==='urgent'||row.urgency_reason==='zero_stock'?'Urgent stock requirement.':''
 const statusLabel=history?({received:'Received',closed:'Closed',cancelled:'Cancelled'}[row.status]||'Rejected'):({'Review hold':'On hold','Review quantity':'Awaiting quantity review','Approve quantity':'Awaiting quantity approval','Approve order':'Awaiting approval','Send order':'Approved · not sent','Compare prices':'Prices ready to compare','Review draft':'Draft order','Prepare supplier request':'Request not sent','Assign supplier':'Supplier setup needed','Record delivery':'Awaiting delivery','Follow up prices':'Awaiting supplier response'}[primaryAction?.label])|| (orders.some(p=>p.status==='pending_approval')?'Awaiting approval':orders.some(p=>p.status==='approved')?'Approved · not sent':stillReceive>0?'Awaiting delivery':activeQuotes.length?'Awaiting supplier response':'Awaiting purchasing action')
 return {id:row.id,row,rfqs,orders,receipts,stillBuy,stillReceive,reserved,history,actions:unique,primaryAction,secondaryAction:secondaryAction||null,statusLabel,attention,tab:history?'History':unique.length?'Needs me':'In progress'}
}
