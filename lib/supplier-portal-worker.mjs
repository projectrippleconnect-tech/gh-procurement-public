import {wahaGatewayConfig} from './waha-gateway.mjs'
import {createClient} from '@supabase/supabase-js'
import {timingSafeEqual} from 'node:crypto'
import {supplierPoImages} from './supplier-po-image.mjs'
import {extractWahaMessageId,wahaImagePayload} from './waha-rfq.js'
export function authorizedWorker(request,env){
 const expected=env.GH_PORTAL_WORKER_SECRET||'',value=(request.headers.get('authorization')||'').replace(/^Bearer /,'')
 return expected.length>=32&&Buffer.byteLength(value)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(value),Buffer.from(expected))
}
export function workerGateway(env){
 if(env.GH_PORTAL_DISPATCH_ENABLED!=='true'||env.GH_PORTAL_DELIVERY_VERIFIED!=='true'||env.WAHA_SENDING_ENABLED!=='true')return null
 return wahaGatewayConfig(env)
}
export async function runPortalWorker({env=process.env,db,fetcher=fetch,render=supplierPoImages}={}){
 const processRounds=env.GH_PORTAL_PROCESSING_ENABLED==='true'&&env.GH_PORTAL_SCHEDULER_MODE!=='database'
 if(!processRounds&&env.GH_PORTAL_DISPATCH_ENABLED!=='true')return {status:'disabled'}
 if(!db){
  if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw Error('Portal server credentials are missing')
  db=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},db:{timeout:20000,retry:false}})
 }
 const call=async(name,args={})=>{const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data}
 const result={rounds:[],dispatch:null}
 if(processRounds){
  const due=await call('proc_portal_due_rounds_v1')
  for(const id of due||[]){
   try{result.rounds.push(await call('proc_portal_process_round_v1',{p_round_id:id}))}
   catch(e){await call('proc_portal_record_exception_v1',{p_round_id:id,p_error:String(e.message||e).slice(0,500)});result.rounds.push({status:'exception',round_id:id})}
  }
 }
 const gateway=workerGateway(env)
 if(!gateway)return result
 const sessionResponse=await fetcher(gateway.base+'/api/sessions/'+encodeURIComponent(gateway.session),{headers:{'X-Api-Key':gateway.key,Accept:'application/json'},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)})
 if(!sessionResponse.ok||(await sessionResponse.json())?.status!=='WORKING')return {...result,dispatch:'gateway_offline'}
 const job=await call('proc_portal_claim_dispatch_v1')
 if(!job||job.blocked)return {...result,dispatch:job||'none'}
 let status='failed',messageId=null,contacted=false
 try{
  const doc=job.document
  if(!doc.lines?.length||doc.lines.length>35)throw Error('Oversized order requires manual dispatch')
  const pages=await render({po_no:doc.po.po_no,company:doc.po.company_id?'Company Items':'General Items',supplier:doc.supplier.name,
   document_template:{fields:{rate:false}},lines:doc.lines.map(l=>({description:[l.description,l.size].filter(Boolean).join(' '),qty:l.qty,uom:l.uom,unit_price:l.unit_price}))})
  if(pages.length!==1)throw Error('Multiple-page order requires manual dispatch')
  const payload=wahaImagePayload({session:gateway.session,phone:job.phone,filename:doc.po.po_no+'.png',base64:pages[0].toString('base64'),caption:'General Hardware — Approved Purchase Order '+doc.po.po_no+'. Please confirm delivery. Reference '+job.job_id})
  contacted=true
  const response=await fetcher(gateway.base+'/api/sendImage',{method:'POST',headers:{'X-Api-Key':gateway.key,'Content-Type':'application/json'},body:JSON.stringify(payload),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000)})
  status=response.ok?'accepted':response.status>=500?'unknown':'failed'
  if(response.ok){messageId=extractWahaMessageId(await response.json());if(!messageId)status='unknown'}
 }catch{status=contacted?'unknown':'failed'}
 const finished=await call('proc_portal_finish_dispatch_v1',{p_job_id:job.job_id,p_status:status,p_message_id:messageId})
 if(!finished)throw Error('Dispatch audit did not persist; reconcile the gateway before any resend')
 return {...result,dispatch:{status,job_id:job.job_id}}
}
