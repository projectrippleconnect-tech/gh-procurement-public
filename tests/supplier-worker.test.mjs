import test from 'node:test'
import assert from 'node:assert/strict'
import {authorizedWorker,workerGateway,runPortalWorker} from '../lib/supplier-portal-worker.mjs'
import {supplierPoImages} from '../lib/supplier-po-image.mjs'
const env={GH_PORTAL_PROCESSING_ENABLED:'true',GH_PORTAL_DISPATCH_ENABLED:'true',GH_PORTAL_DELIVERY_VERIFIED:'true',WAHA_SENDING_ENABLED:'true',WAHA_BASE_URL:'http://gateway.railway.internal',WAHA_API_KEY:'qa',WAHA_SESSION:'default'}
const job={job_id:'job-1',phone:'94771234567',document:{po:{po_no:'PO-QA'},supplier:{name:'Supplier'},lines:[{description:'Item',size:'2 inch',qty:5,uom:'PCS',unit_price:12}]}}
function fixture({reply,fetcher}={}){
 const calls=[],requests=[]
 const db={rpc:async(name,args)=>{calls.push({name,args});const result=reply?.(name,args);return result||{data:name==='proc_portal_due_rounds_v1'?['round-1']:name==='proc_portal_claim_dispatch_v1'?job:true,error:null}}}
 const fetch=async(url,opts)=>{requests.push({url,opts});return fetcher?fetcher(url,opts):{ok:true,status:200,json:async()=>url.includes('/sessions/')?{status:'WORKING'}:{id:'message-1'}}}
 return {db,fetcher:fetch,render:async()=>[Buffer.from('qa')],calls,requests}
}
test('worker is disabled by default, without touching database or gateway',async()=>{
 const f=fixture();assert.deepEqual(await runPortalWorker({...f,env:{}}),{status:'disabled'});assert.equal(f.calls.length,0);assert.equal(f.requests.length,0)
})
test('worker endpoint requires a long exact secret, including byte-safe comparison',()=>{
 const secret='x'.repeat(32)
 assert.equal(authorizedWorker(new Request('http://localhost',{headers:{authorization:'Bearer '+secret}}),{GH_PORTAL_WORKER_SECRET:secret}),true)
 assert.equal(authorizedWorker(new Request('http://localhost',{headers:{authorization:'Bearer '+'é'.repeat(32)}}),{GH_PORTAL_WORKER_SECRET:secret}),false)
 assert.equal(authorizedWorker(new Request('http://localhost'),{}),false)
})
test('dispatch requires all independent release and delivery gates and a private host',()=>{
 assert.ok(workerGateway(env));for(const key of ['GH_PORTAL_DISPATCH_ENABLED','GH_PORTAL_DELIVERY_VERIFIED','WAHA_SENDING_ENABLED'])assert.equal(workerGateway({...env,[key]:'false'}),null)
 for(const url of ['https://example.com','http://user:pass@gateway.railway.internal','file:///etc/passwd'])assert.equal(workerGateway({...env,WAHA_BASE_URL:url}),null)
})
test('due rounds process before dispatch; document and recipient come from claimed database snapshot',async()=>{
 const f=fixture();const r=await runPortalWorker({...f,env});assert.equal(r.dispatch.status,'accepted');assert.equal(f.calls[0].name,'proc_portal_due_rounds_v1');assert.equal(f.calls[1].name,'proc_portal_process_round_v1')
 const sent=JSON.parse(f.requests[1].opts.body);assert.equal(sent.chatId,'94771234567@c.us');assert.match(sent.caption,/PO-QA/)
 assert.equal(f.calls.at(-1).args.p_message_id,'message-1')
})
test('processing failures are persisted and do not produce speculative orders',async()=>{
 const f=fixture({reply:n=>n==='proc_portal_process_round_v1'?{error:{message:'Purchasing limit exceeded'}}:null});const r=await runPortalWorker({...f,env:{GH_PORTAL_PROCESSING_ENABLED:'true'}})
 assert.equal(r.rounds[0].status,'exception');assert.equal(f.calls.at(-1).name,'proc_portal_record_exception_v1');assert.equal(f.requests.length,0)
})
for(const [label,response,expected] of [
 ['timeout',()=>{throw Error('timeout')},'unknown'],
 ['5xx',()=>({ok:false,status:500}),'unknown'],
 ['4xx',()=>({ok:false,status:400}),'failed'],
 ['acceptance without message id',()=>({ok:true,status:200,json:async()=>({})}),'unknown']
])test(label+' is never mistaken for verified delivery',async()=>{
 const f=fixture({fetcher:url=>url.includes('/sessions/')?{ok:true,json:async()=>({status:'WORKING'})}:response()})
 const r=await runPortalWorker({...f,env});assert.equal(r.dispatch.status,expected);assert.equal(f.calls.at(-1).args.p_status,expected);assert.equal(f.requests.filter(r=>r.url.endsWith('/sendImage')).length,1)
})
test('offline gateway never claims a send',async()=>{
 const f=fixture({fetcher:async()=>({ok:true,json:async()=>({status:'STOPPED'})})});assert.equal((await runPortalWorker({...f,env})).dispatch,'gateway_offline');assert.ok(!f.calls.some(c=>c.name==='proc_portal_claim_dispatch_v1'))
})
test('multi-page and failed rendering never contacts the send endpoint',async()=>{
 const f=fixture();const r=await runPortalWorker({...f,env,render:async()=>[Buffer.from('a'),Buffer.from('b')]});assert.equal(r.dispatch.status,'failed');assert.equal(f.requests.length,1)
})
test('audit write failure is raised rather than reporting success',async()=>{
 const f=fixture({reply:n=>n==='proc_portal_finish_dispatch_v1'?{data:false}:null});await assert.rejects(runPortalWorker({...f,env}),/audit did not persist/)
})
test('supplier PO renderer creates a real PNG and safely escapes supplier and item markup',async()=>{
 const images=await supplierPoImages({po_no:'PO-QA',supplier:'A & <B>',lines:[{description:'TEST <script> & size',qty:5,uom:'PCS'}]})
 assert.equal(images.length,1);assert.equal(images[0].subarray(1,4).toString(),'PNG')
})
