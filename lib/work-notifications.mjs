// First successful snapshot establishes a baseline; failed reads never advance it.
export function changedWork(previous,rows,type){
 const events=[]
 const next=new Map(rows.map(r=>[r.id,r]))
 if(previous)for(const row of rows){
  const old=previous.get(row.id)
  if(type==='reply'){
   if(row.status==='quoted'&&row.replied_at&&(!old||old.replied_at!==row.replied_at))events.push({key:`reply:${row.id}:${row.replied_at}`,text:'Supplier prices received — ready to review.',view:'rfq',filter:row.rfq_id})
  }else if(!old||old.status!==row.status){
   events.push({key:`${type}:${row.id}:${row.status}`,text:`${type==='rfq'?'RFQ':'Order'} ${row.rfq_no||row.po_no||''}: ${String(row.status).replaceAll('_',' ')}.`,view:type,filter:row.id})
  }
 }
 return {next,events}
}
export function reminderDue(last,now,delay=4*60*60*1000){return !last||now-last>=delay}
