import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import webpush from 'npm:web-push@3.6.7'
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors={'Access-Control-Allow-Origin':'https://gh-procurement.netlify.app','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-retry-count, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json'}
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors})
async function checked(query:any){const r=await query;if(r.error)throw r.error;return r.data}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors})
 if(req.method!=='POST')return json({error:'Method not allowed'},405)
 try{
  const config=await checked(db.from('proc_push_config').select('*').eq('id',true).single())
  const worker=req.headers.get('x-worker-secret')===config.worker_secret
  let userId=''
  if(!worker){
   const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||''
   const {data,error}=await db.auth.getUser(token);if(error||!data.user)return json({error:'Sign in required'},401)
   const p=await checked(db.from('proc_profiles').select('active,role,role_key,deleted_at').eq('id',data.user.id).single())
   const role=await checked(db.from('proc_roles').select('enabled').eq('role_key',p.role_key).single())
   if(p.deleted_at||!p.active||p.role!=='admin'||!role.enabled)return json({error:'Admin required'},403)
   userId=data.user.id
  }
  if(!config.vapid_public){
   const keys=webpush.generateVAPIDKeys()
   await checked(db.from('proc_push_config').update({vapid_public:keys.publicKey,vapid_private:keys.privateKey}).eq('id',true).is('vapid_public',null))
   Object.assign(config,await checked(db.from('proc_push_config').select('*').eq('id',true).single()))
  }
  webpush.setVapidDetails('https://gh-procurement.netlify.app',config.vapid_public,config.vapid_private)
  if(!worker){
   const body=await req.json().catch(()=>({}))
   if(body.action==='test'){
    if(typeof body.endpoint!=='string')return json({error:'Choose this registered phone'},400)
    const subs=await checked(db.from('proc_push_subscriptions').select('*').eq('user_id',userId).eq('endpoint',body.endpoint))
    for(const s of subs)await webpush.sendNotification(s.subscription,JSON.stringify({title:'GH Procurement notifications enabled',body:'Stock, orders, supplier prices and exceptions will appear here.',url:'/',tag:'gh-push-test'}),{TTL:300,timeout:10000})
    return json({accepted:subs.length})
   }
   return json({publicKey:config.vapid_public})
  }
  const claimed=await checked(db.rpc('proc_push_claim_v1',{p_limit:10}))
  let sent=0,failed=0
  for(const n of claimed){
   try{
    const endpoint=new URL(n.subscription.endpoint)
    if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||!(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/).test(endpoint.hostname))throw Error('Invalid push endpoint')
    await webpush.sendNotification(n.subscription,JSON.stringify({title:n.title,body:n.body,url:'/?notification='+n.notification_id,tag:n.event_key}),{TTL:86400,urgency:'high',timeout:10000})
    await checked(db.from('proc_push_deliveries').update({sent_at:new Date().toISOString(),last_error:null}).eq('notification_id',n.notification_id).eq('subscription_id',n.subscription_id));sent++
   }catch(e:any){
    failed++
    if([404,410].includes(e.statusCode)){await checked(db.from('proc_push_subscriptions').delete().eq('id',n.subscription_id));continue}
    await checked(db.from('proc_push_deliveries').update({next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**(n.attempt-1))).toISOString(),last_error:'Push service HTTP '+(e.statusCode||'network failure')}).eq('notification_id',n.notification_id).eq('subscription_id',n.subscription_id))
   }
  }
  return json({sent,failed})
 }catch(_e){return json({error:'Notification service unavailable'},500)}
})
