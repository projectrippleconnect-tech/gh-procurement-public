export const DEFAULT_RFQ_CAPTION='General Hardware — Supplier Price Request\nRFQ: {rfq_number}\nSupplier: {supplier_name}\nDue: {due_date}\nPlease check the attached RFQ image and reply with your unit rates.'

export function supplierCaption(template,rfq,supplier,company){
 const caption=String(template).replaceAll('\\n','\n').replaceAll('{company_name}',String(company?.name||'General Hardware')).replaceAll('{rfq_number}',String(rfq.rfq_no||'')).replaceAll('{supplier_name}',String(supplier.name||'')).replaceAll('{due_date}',String(rfq.due_date||'Not specified')).trim()
 if(!caption||caption.length>2000)throw new Error('Each caption must contain 1–2000 characters.')
 return caption
}

// Each recipient is independent; no automatic retry can duplicate an uncertain send.
export async function runSupplierBatch(jobs,send,{onResult=()=>{},shouldStop=()=>false}={}){
 const seen=new Set(),queue=jobs.filter(job=>{if(!job.supplierId||seen.has(job.supplierId))return false;seen.add(job.supplierId);return true}),results=[]
 let halted=false
 for(const job of queue){
  let result
  if(halted||shouldStop())result={supplierId:job.supplierId,status:'not_attempted',message:'Not attempted. Select this supplier in a new batch when ready.'}
  else try{
   const response=await send(job)
   if(response?.status!=='accepted')throw Object.assign(new Error('The sending result is uncertain. Check WhatsApp before resending.'),{sendStatus:'unknown',haltBatch:true})
   result={supplierId:job.supplierId,status:'accepted',message:'PNG and caption accepted for sending.'}
  }catch(error){
   result={supplierId:job.supplierId,status:error.sendStatus||'failed',message:error.message||'Could not send this request.'}
   if(error.haltBatch)halted=true
  }
  results.push(result);onResult(result)
 }
 return results
}
