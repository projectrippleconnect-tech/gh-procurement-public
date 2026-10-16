import {companyAccess,companyBody,companyReply} from '@/lib/company-server'
import {extractWahaMessageId,normalizeSupplierChatId} from '@/lib/waha-rfq'
import {companyOrderImages} from '@/lib/company-order-image.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 try{
  const {db}=await companyAccess(request),body=await companyBody(request)
  const raw=process.env.WAHA_BASE_URL,key=process.env.WAHA_API_KEY,session=process.env.WAHA_SESSION||'default'
  if(!raw||!key||process.env.WAHA_SENDING_ENABLED!=='true')throw new Error('Company orders are queued. Automatic WhatsApp sending is not configured or enabled.')
  const url=new URL(raw);if(!['http:','https:'].includes(url.protocol)||!url.hostname.endsWith('.railway.internal')||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^[\w-]{1,50}$/.test(session))throw new Error('Invalid private WhatsApp gateway configuration.')
  const check=await fetch(url.origin+'/api/sessions/'+session,{headers:{'X-Api-Key':key},signal:AbortSignal.timeout(5000),cache:'no-store'})
  if(!check.ok||(await check.json()).status!=='WORKING')throw new Error('WhatsApp is offline. Company orders remain queued.')
  let query=db.from('proc_company_dispatch_queue').select('id').in('status',['pending','failed']).order('created_at').limit(5)
  if(body.companyId)query=query.eq('company_id',body.companyId)
  if(body.poIds!==undefined){
   if(!Array.isArray(body.poIds)||!body.poIds.length||body.poIds.length>15||body.poIds.some((id:unknown)=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))throw new Error('Select valid purchase orders.')
   query=query.in('po_id',body.poIds).limit(15)
  }
  const {data:queue,error}=await query;if(error)throw error
  let accepted=0;const outcomes:object[]=[]
  for(const row of queue||[]){
   const {data:job,error:claimError}=await db.rpc('proc_company_claim_send',{p_id:row.id});if(claimError){outcomes.push({id:row.id,error:claimError.message});continue}if(!job)continue
   let status='failed',messageId=null,lastError:string|null=null,contacted=false
   try{
    const chatId=normalizeSupplierChatId(job.phone)
    const images=await companyOrderImages(job)
    let response:Response|null=null
    for(let page=0;page<images.length;page++){
     contacted=true
     response=await fetch(url.origin+'/api/sendImage',{method:'POST',headers:{'X-Api-Key':key,'Content-Type':'application/json'},body:JSON.stringify({session,chatId,file:{mimetype:'image/png',filename:'PO-'+job.po_no+'-'+(page+1)+'.png',data:images[page].toString('base64')},caption:'General Hardware — PO '+job.po_no+' · '+(page+1)+'/'+images.length+'\nPlease confirm availability and delivery.'}),signal:AbortSignal.timeout(25000),cache:'no-store'})
     if(!response.ok)break
    }
    if(!response)throw new Error('No order image was generated.')
    // Once a page has been accepted, a later rejection is uncertain as a whole.
    status=response.ok?'accepted':images.length>1||response.status>=500?'unknown':'failed'
    if(response.ok){messageId=extractWahaMessageId(await response.json().catch(()=>({})));
     for(const attachment of job.attachments||[]){
      const {data:file,error:downloadError}=await db.storage.from('gh-procurement').download(attachment.storage_path);if(downloadError||!file)throw new Error('PO accepted, but its selected attachment could not be loaded.');
      if(file.size>10*1024*1024)throw new Error('Selected attachment exceeds 10 MB.');
      const sent=await fetch(url.origin+'/api/sendFile',{method:'POST',headers:{'X-Api-Key':key,'Content-Type':'application/json'},body:JSON.stringify({session,chatId,file:{mimetype:attachment.mime_type,filename:attachment.name,data:Buffer.from(await file.arrayBuffer()).toString('base64')},caption:[attachment.remarks,attachment.discount_percent?'Discount: '+attachment.discount_percent+'%':'',attachment.discount_amount?'Fixed discount: '+attachment.discount_amount:''].filter(Boolean).join('\n').slice(0,2000)}),signal:AbortSignal.timeout(25000),cache:'no-store'});if(!sent.ok)throw new Error('PO accepted, but a selected attachment was rejected.');
     }
     accepted++
    }else lastError='WhatsApp rejected the order (HTTP '+response.status+').'
   }catch(e){status=contacted?'unknown':'failed';lastError=contacted?'Gateway response interrupted. Check WhatsApp before resending.':e instanceof Error?e.message:'Order generation failed.'}
   const {error:finishError}=await db.rpc('proc_company_finish_send',{p_id:row.id,p_status:status,p_message_id:messageId,p_error:lastError})
   outcomes.push({id:row.id,status,error:finishError?'Audit update failed; do not resend.':lastError})
  }
  return companyReply({ok:true,message:accepted+' company purchase order(s) accepted by WhatsApp. Review pending or failed outcomes in Company settings.',outcomes})
 }catch(e){return companyReply({ok:false,error:e instanceof Error?e.message:'Automatic company orders failed.'},400)}
}
