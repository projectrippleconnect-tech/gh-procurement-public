// Fail-closed policy for unattended WhatsApp supplier delivery.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function eligibleAutomaticJob(job,cutoff){
 const start=Date.parse(String(cutoff||''))
 const created=Date.parse(String(job?.created_at||''))
 if(!Number.isFinite(start)||!Number.isFinite(created))return false
 return created>=start&&UUID.test(String(job?.entity_id||''))&&
  job?.status==='needs_action'&&['rfq_send','po_send'].includes(job?.job_type)&&
  ((job.job_type==='rfq_send'&&job.entity_type==='rfq')||(job.job_type==='po_send'&&job.entity_type==='po'))
}
export function hasExistingAttempt(attempts){
 // Sending/unknown/failed MUST NOT be silently retried.
 return !Array.isArray(attempts)||attempts.length>0
}
export function supplierSendRows(rows){
 if(!Array.isArray(rows)||rows.length<1)throw new Error('Document has no supplier items')
 return rows.map((row,index)=>{
  const description=String(row?.description||'').trim()
  const size=String(row?.size||'').trim()
  const uom=String(row?.uom||'').trim()
  const qty=Number(row?.qty)
  if(!description||!Number.isFinite(qty)||qty<=0||!uom)throw new Error('Incomplete supplier item '+(index+1))
  const extra={}
  if(row?.unitPrice!==undefined||row?.lineTotal!==undefined){
   const unitPrice=Number(row?.unitPrice),lineTotal=Number(row?.lineTotal)
   if(row?.unitPrice===null||row?.lineTotal===null||!Number.isFinite(unitPrice)||unitPrice<0||
      !Number.isFinite(lineTotal)||lineTotal<0)throw new Error('Invalid supplier price on item '+(index+1))
   extra.unitPrice=unitPrice;extra.lineTotal=lineTotal
  }
  return {description,size,uom,qty,...extra}
 })
}
export function verifiedAuditGroup({enabled,ownerOnly,groupId}){
 const id=String(groupId||'').trim()
 return enabled==='true'&&ownerOnly==='true'&&/^[0-9-]{10,60}@g\.us$/.test(id)?id:null
}
