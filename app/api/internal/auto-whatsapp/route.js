import {createClient} from '@supabase/supabase-js'
import {createHash,timingSafeEqual} from 'node:crypto'
import {renderProcurementPng} from '@/lib/procurement-auto-png.mjs'
import {eligibleAutomaticJob,hasExistingAttempt,supplierSendRows,verifiedAuditGroup} from '@/lib/procurement-auto-selection.mjs'
import {supplierRequestItems} from '@/lib/rfq-sheet'
import {gatewayConfig} from '@/lib/waha-gateway-config'

// Strictly disabled until all live acceptance gates have passed.
// Existing production and historical needs_action jobs are not automatically replayed.
export const runtime='nodejs'
export const dynamic='force-dynamic'
const ORIGIN='https://gh-procurement.netlify.app'
const json=(value,status=200)=>Response.json(value,{status,headers:{'cache-control':'no-store'}})
const truth=v=>v==='true'
const safeEqual=(expected,received)=>{
 if(typeof expected!=='string'||expected.length<32||typeof received!=='string')return false
 const a=createHash('sha256').update(expected).digest()
 const b=createHash('sha256').update(received).digest()
 return timingSafeEqual(a,b)
}
const hardFail=(message,status=503)=>json({ok:false,error:message},status)
const checked=({data,error},message)=>{if(error)throw new Error(message);return data}
const isoCutoff=()=>{
 const raw=String(process.env.GH_AUTO_DISPATCH_AFTER||'')
 const date=Date.parse(raw)
 if(!/^20\d\d-\d\d-\d\dT/.test(raw)||!Number.isFinite(date)||date>Date.now())throw new Error('Auto-dispatch activation cutoff is missing or future.')
 return new Date(date).toISOString()
}
const auditGroup=kind=>verifiedAuditGroup({
 enabled:process.env.GH_WA_AUDIT_ENABLED,
 ownerOnly:process.env.GH_WA_AUDIT_OWNER_ONLY,
 groupId:kind==='po'?process.env.GH_WA_AUDIT_PO_GROUP_ID:process.env.GH_WA_AUDIT_RFQ_GROUP_ID
})
function requiredConfiguration(){
 if(!truth(process.env.GH_AUTO_DISPATCH_ENABLED)||!truth(process.env.WAHA_SENDING_ENABLED)||
    !truth(process.env.GH_AUTO_DELIVERY_TEST_VERIFIED))return null
 if(!auditGroup('rfq')||!auditGroup('po')||!gatewayConfig())return null
 if(!process.env.GH_AUTO_ACCOUNT_EMAIL||!process.env.GH_AUTO_ACCOUNT_PASSWORD)return null
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 if(!url||!key)return null
 return {url,key}
}
async function operatorClient(url,key){
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
 const {data,error}=await db.auth.signInWithPassword({email:process.env.GH_AUTO_ACCOUNT_EMAIL,password:process.env.GH_AUTO_ACCOUNT_PASSWORD})
 if(error||!data?.user||!data?.session?.access_token)throw new Error('Dedicated automation operator login failed')
 const profile=checked(await db.from('proc_profiles').select('role,active').eq('id',data.user.id).maybeSingle(),'Operator access lookup failed')
 if(!profile?.active||!['admin','procurement'].includes(profile.role))throw new Error('Automation operator is not approved')
 return {db,token:data.session.access_token}
}
async function itemsForIds(db,ids){
 const keys=[...new Set(ids.filter(Boolean))]
 if(!keys.length)throw new Error('Supplier order has no items')
 const items=checked(await db.from('proc_items').select('id,description,size,uom,category,main_group,subgroup').in('id',keys),'Item catalogue unavailable')
 const map=new Map(items.map(x=>[x.id,x]))
 if(keys.some(k=>!map.has(k)))throw new Error('Incomplete supplier order catalogue')
 return map
}
async function rfqWork(db,rfqId){
 const rfq=checked(await db.from('proc_rfqs').select('id,rfq_no,due_date,status').eq('id',rfqId).maybeSingle(),'RFQ lookup failed')
 if(!rfq||['awarded','closed','cancelled'].includes(rfq.status))return []
 const raw=checked(await db.from('proc_rfq_items').select('id,requirement_id,requested_qty').eq('rfq_id',rfqId),'RFQ lines unavailable')
 if(!raw.length)throw new Error('RFQ contains no lines')
 const requirements=checked(await db.from('proc_requirements').select('id,item_id').in('id',[...new Set(raw.map(x=>x.requirement_id))]),'RFQ requirements unavailable')
 const req=new Map(requirements.map(x=>[x.id,x]))
 const catalog=await itemsForIds(db,requirements.map(x=>x.item_id))
 const items=raw.map(x=>({...x,requirement:{...req.get(x.requirement_id),item:catalog.get(req.get(x.requirement_id)?.item_id)}}))
 if(items.some(x=>!x.requirement.item))throw new Error('Incomplete RFQ item mapping')
 const invitations=checked(await db.from('proc_rfq_suppliers').select('id,supplier_id,status,requested_item_ids,scope_override_reason').eq('rfq_id',rfqId),'RFQ invitation list unavailable')
 const output=[]
 for(const inv of invitations.filter(x=>['pending','prepared'].includes(x.status))){
  const existing=checked(await db.from('proc_whatsapp_rfq_dispatches').select('id,status').eq('rfq_id',rfqId).eq('supplier_id',inv.supplier_id).limit(1),'RFQ send history unavailable')
  if(hasExistingAttempt(existing))continue
  const supplier=checked(await db.from('proc_suppliers').select('id,name,phone,whatsapp,active').eq('id',inv.supplier_id).maybeSingle(),'Supplier lookup failed')
  if(!supplier?.active)continue
  const scopes=checked(await db.from('proc_supplier_scopes').select('supplier_id,scope_type,item_id,scope_value').eq('supplier_id',inv.supplier_id),'Supplier scope unavailable')
  const selected=supplierRequestItems(items,inv,scopes)
  if(!selected.length)continue
  output.push({kind:'rfq',id:rfq.id,supplierId:supplier.id,number:rfq.rfq_no,supplier:supplier.name,
   dueDate:rfq.due_date,rows:supplierSendRows(selected.map(x=>({
    description:x.requirement.item.description,size:x.requirement.item.size,uom:x.requirement.item.uom,qty:x.requested_qty
   })))})
 }
 return output
}
async function poWork(db,poId){
 const po=checked(await db.from('proc_purchase_orders').select('id,po_no,status,supplier_id,po_date,quantity_only').eq('id',poId).maybeSingle(),'PO lookup failed')
 if(!po||po.status!=='approved')return []
 const existing=checked(await db.from('proc_whatsapp_po_dispatches').select('id,status').eq('po_id',poId).limit(1),'PO send history unavailable')
 if(hasExistingAttempt(existing))return []
 const supplier=checked(await db.from('proc_suppliers').select('id,name,active').eq('id',po.supplier_id).maybeSingle(),'PO supplier lookup failed')
 if(!supplier?.active)return []
 const lines=checked(await db.from('proc_po_lines').select('item_id,qty,unit_price,line_total').eq('po_id',poId),'PO lines unavailable')
 const items=await itemsForIds(db,lines.map(x=>x.item_id))
 return [{kind:'po',id:po.id,number:po.po_no,supplier:supplier.name,dueDate:po.po_date,
  rows:supplierSendRows(lines.map(x=>({description:items.get(x.item_id)?.description,size:items.get(x.item_id)?.size,
  uom:items.get(x.item_id)?.uom,qty:x.qty,
  ...(po.quantity_only?{}:{unitPrice:x.unit_price,lineTotal:x.line_total})})))}]
}
async function auditCopy(db,work,document,dispatchId){
 const config=gatewayConfig(),groupId=auditGroup(work.kind)
 if(!config||!groupId||!dispatchId)throw new Error('Owner-only audit configuration is incomplete')
 const caption='GH PROCUREMENT PRIVATE AUDIT - '+work.kind.toUpperCase()+' '+work.number+' - '+work.supplier
 const hash=createHash('sha256').update(document.png).digest('hex')
 const attemptId=checked(await db.rpc('proc_whatsapp_claim_private_group_copy',{
  p_kind:work.kind,p_source_id:dispatchId,p_page:1,p_group_id:groupId,p_session:config.session,
  p_image_sha256:hash,p_caption:caption
 }),'Could not claim private audit copy')
 let status='unknown',messageId=null,lastError=null
 try{
  const response=await fetch(config.base+'/api/sendImage',{method:'POST',
   headers:{'X-Api-Key':config.key,'Content-Type':'application/json',Accept:'application/json'},
   body:JSON.stringify({session:config.session,chatId:groupId,
    file:{mimetype:'image/png',filename:'GH-'+work.kind.toUpperCase()+'-'+work.id+'.png',data:document.base64},caption}),
   cache:'no-store',redirect:'error',signal:AbortSignal.timeout(25000)})
  if(response.ok){
   const data=await response.json().catch(()=>({}))
   messageId=typeof data?.id==='string'?data.id:typeof data?.id?._serialized==='string'?data.id._serialized:null
   status='accepted'
  }else{
   status=response.status>=500?'unknown':'failed'
   lastError='Private group gateway returned HTTP '+response.status
  }
 }catch{lastError='Private group outcome unknown - do not retry automatically'}
 const updated=checked(await db.rpc('proc_whatsapp_finish_private_group_copy',{
  p_id:attemptId,p_status:status,p_message_id:messageId,p_error:lastError
 }),'Could not finalize private audit copy')
 if(!updated||status!=='accepted')throw new Error('Owner audit copy not confirmed as accepted; inspect the group manually')
 return true
}
async function sendWork(db,token,work){
 const document=renderProcurementPng(work)
 const caption=work.kind==='rfq'?
  'General Hardware - RFQ '+work.number+'. Please review the attached price request and submit your prices.':
  'General Hardware - PO '+work.number+'. Please confirm availability and delivery.'
 const payload={pngBase64:document.base64,caption,
  ...(work.kind==='rfq'?{rfqId:work.id,supplierId:work.supplierId}:{poId:work.id})}
 const response=await fetch(ORIGIN+'/api/integrations/whatsapp/'+work.kind,{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify(payload),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(40000)
 })
 const data=await response.json().catch(()=>({}))
 if(!response.ok){
  // Even 4xx may record a send attempt. Never auto-retry any error.
  throw new Error('Supplier gateway send not accepted (HTTP '+response.status+'). Inspect the dispatch audit; no retry.')
 }
 if(data.status!=='accepted'||!data.dispatchId)throw new Error('Missing audited supplier acceptance; inspect before retry')
 await auditCopy(db,work,document,data.dispatchId)
 return {kind:work.kind,number:work.number,supplierAccepted:true,auditAccepted:true,deliveryVerified:false}
}
export async function POST(request){
 if(!safeEqual(process.env.GH_AUTO_DISPATCH_SECRET,request.headers.get('x-gh-auto-dispatch-secret')))return hardFail('Not authorized',401)
 const config=requiredConfiguration()
 if(!config)return hardFail('Unattended WhatsApp dispatch remains disabled or has not passed the live acceptance gates')
 let cutoff
 try{cutoff=isoCutoff()}catch{return hardFail('Activation cutoff is not valid')}
 try{
  const {db,token}=await operatorClient(config.url,config.key)
  const results=[]
  let scanned=0,more=false
  // Page past previously attempted jobs; always examining the first N would
  // starve newer invitations because accepted jobs remain needs_action until
  // actual recipient delivery is confirmed independently.
  for(let page=0;page<25&&results.length<2;page++){
   const jobs=checked(await db.from('proc_automation_jobs')
    .select('id,job_type,entity_type,entity_id,status,created_at')
    .eq('status','needs_action').in('job_type',['rfq_send','po_send'])
    .gte('created_at',cutoff).order('created_at',{ascending:true}).order('id',{ascending:true})
    .range(page*20,page*20+19),'Automation job list unavailable')
   scanned+=jobs.length
   for(const job of jobs){
    if(!eligibleAutomaticJob(job,cutoff))continue
    const work=job.job_type==='rfq_send'?await rfqWork(db,job.entity_id):await poWork(db,job.entity_id)
    for(const row of work.slice(0,Math.max(0,2-results.length))){
     // Stop on ANY uncertain send; immutable history prevents silent retries.
     results.push(await sendWork(db,token,row))
    }
    if(results.length>=2)break
   }
   if(jobs.length<20)break
   if(page===24)more=true
  }
  return json({ok:true,processed:results.length,scanned,more,results,
   notice:'API acceptance is not proof of recipient delivery.'})
 }catch(e){
  return hardFail('Auto-dispatch stopped safely: '+(e instanceof Error?e.message:'unexpected error'),503)
 }
}
