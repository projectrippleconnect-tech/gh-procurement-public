import {companyAccess,companyBody,companyReply} from '@/lib/company-server'
import {companyOrderImages} from '@/lib/company-order-image.mjs'
import {routeCaption} from '@/lib/company-route-template.mjs'
import {extractWahaMessageId,normalizeSupplierChatId} from '@/lib/waha-rfq'
import {createHash} from 'node:crypto'
import {checkedRfqIds} from '@/lib/company-rfq-dispatch-scope.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 try{
  const {db}=await companyAccess(request),body=await companyBody(request)
  const raw=process.env.WAHA_BASE_URL,key=process.env.WAHA_API_KEY,session=process.env.WAHA_SESSION||'default'
  if(!raw||!key||process.env.WAHA_SENDING_ENABLED!=='true')throw new Error('RFQs remain queued. Enable automatic WhatsApp sending.')
  const url=new URL(raw)
  if(!['http:','https:'].includes(url.protocol)||!url.hostname.endsWith('.railway.internal')||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^[\w-]{1,50}$/.test(session))throw new Error('Invalid private gateway configuration.')
  const check=await fetch(url.origin+'/api/sessions/'+session,{headers:{'X-Api-Key':key},signal:AbortSignal.timeout(5000),cache:'no-store'})
  if(!check.ok||(await check.json()).status!=='WORKING')throw new Error('WhatsApp is offline; RFQ images remain queued.')
  let query=db.from('proc_company_rfq_queue').select('id').in('status',['pending','failed']).order('created_at').limit(50)
  if(body.companyId)query=query.eq('company_id',body.companyId)
  // Stock submissions provide RFQ IDs; they may never drain older company queues.
  if(body.rfqIds!==undefined)query=query.in('rfq_id',checkedRfqIds(body.rfqIds))
  const {data:queue,error}=await query;if(error)throw error
  let accepted=0;const outcomes:object[]=[]
  for(const row of queue||[]){
   const {data:job,error:readError}=await db.rpc('proc_company_rfq_job',{p_id:row.id})
   if(readError||!job){outcomes.push({id:row.id,error:readError?.message});continue}
   // Render before claiming, so a rendering failure is safe to correct and resume.
   let images:Buffer[],caption:string
   try{images=await companyOrderImages(job);caption=routeCaption(job)}catch(e){outcomes.push({id:row.id,status:'failed',error:e instanceof Error?e.message:'Image generation failed'});continue}
   const {data:claim,error:claimError}=await db.rpc('proc_company_claim_rfq_send',{p_id:row.id,p_session:session,p_image_sha256:createHash('sha256').update(Buffer.concat(images)).digest('hex'),p_caption:caption})
   if(claimError||!claim){outcomes.push({id:row.id,status:'blocked',error:claimError?.message||'An existing attempt or route change blocked sending.'});continue}
   let status='unknown',messageId=null,lastError:string|null=null
   try{
    const chatId=normalizeSupplierChatId(claim.phone)
    for(let i=0;i<images.length;i++){
     const response=await fetch(url.origin+'/api/sendImage',{method:'POST',headers:{'X-Api-Key':key,'Content-Type':'application/json'},body:JSON.stringify({session,chatId,file:{mimetype:'image/png',filename:job.rfq_no+'-'+(i+1)+'.png',data:images[i].toString('base64')},caption:caption+'\nPage '+(i+1)+'/'+images.length}),signal:AbortSignal.timeout(25000),cache:'no-store'})
     if(!response.ok){status=i>0||response.status>=500?'unknown':'failed';lastError='WhatsApp rejected the image (HTTP '+response.status+').';break}
     messageId=extractWahaMessageId(await response.json().catch(()=>({})))
     if(i===images.length-1)status='accepted'
    }
   }catch{lastError='Sending interrupted. Check WhatsApp and dispatch history before resending.'}
   const {error:finishError}=await db.rpc('proc_company_finish_rfq_send',{p_id:row.id,p_status:status,p_message_id:messageId,p_error:lastError})
   if(status==='accepted'&&!finishError)accepted++
   outcomes.push({id:row.id,status,error:finishError?'Audit update failed; do not resend.':lastError})
  }
  return companyReply({ok:true,message:accepted+' automatic RFQ image(s) accepted by WhatsApp. Review unsent or uncertain results in Company settings.',outcomes})
 }catch(e){return companyReply({ok:false,error:e instanceof Error?e.message:'Automatic RFQ dispatch failed.'},400)}
}
