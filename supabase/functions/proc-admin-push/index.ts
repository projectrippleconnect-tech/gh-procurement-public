import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import webpush from 'npm:web-push@3.6.7'
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
const cors={'Access-Control-Allow-Origin':'https://gh-procurement.netlify.app','Access-Control-Allow-Headers':'authorization,apikey,content-type','Content-Type':'application/json'}
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
   const p=await checked(db.from('proc_profiles').select('active,role,role_key').eq('id',data.user.id).single())
   const role=await checked(db.from('proc_roles').select('enabled').eq('role_key',p.role_key).single())
   if(!p.active||p.role!=='admin'||!role.enabled)return json({error:'Admin required'},403)
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
    const subs=await checked(db.from('proc_push_subscriptions').select('*').eq('user_id',userId))
    for(const s of subs)await webpush.sendNotification(s.subscription,JSON.stringify({title:'GH Procurement notifications enabled',body:'Stock submissions and supply orders will appear here.',url:'/',tag:'gh-push-test'}),{TTL:300,timeout:10000})
    return json({accepted:subs.length})
   }
   return json({publicKey:config.vapid_public})
  }
  const admins=await checked(db.from('proc_profiles').select('id,role_key').eq('active',true).eq('role','admin').is('deleted_at',null))
  const roles=await checked(db.from('proc_roles').select('role_key').eq('enabled',true))
  const eligible=admins.filter((p:any)=>roles.some((r:any)=>r.role_key===p.role_key)).map((p:any)=>p.id)
  if(!eligible.length)return json({sent:0})
  const subs=await checked(db.from('proc_push_subscriptions').select('*').in('user_id',eligible))
  let sent=0,failed=0
  for(const s of subs){
   const endpoint=new URL(s.endpoint)
   if(endpoint.protocol!=='https:'||endpoint.port||endpoint.username||endpoint.password||!(/^(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)$/).test(endpoint.hostname))continue

   const notes=await checked(db.from('proc_admin_notifications').select('*').eq('recipient_id',s.user_id).gte('created_at',s.created_at).gte('created_at',new Date(Date.now()-86400000).toISOString()).order('created_at').limit(200))
   for(const n of notes){
    await checked(db.from('proc_push_deliveries').upsert({notification_id:n.id,subscription_id:s.id},{onConflict:'notification_id,subscription_id',ignoreDuplicates:true}))
    // Atomic lease: concurrent cron invocations cannot deliver the same row.
    const now=new Date().toISOString()
    const lease=await checked(db.from('proc_push_deliveries').update({next_attempt_at:new Date(Date.now()+120000).toISOString()}).eq('notification_id',n.id).eq('subscription_id',s.id).is('sent_at',null).lte('next_attempt_at',now).lt('attempts',5).select('*').maybeSingle())
    if(!lease)continue
    try{
     await webpush.sendNotification(s.subscription,JSON.stringify({title:n.title,body:n.body,url:'/?notification='+n.id,tag:n.event_key}),{TTL:86400,urgency:'high',timeout:10000})
     await checked(db.from('proc_push_deliveries').update({sent_at:new Date().toISOString(),attempts:lease.attempts+1,last_error:null}).eq('notification_id',n.id).eq('subscription_id',s.id));sent++
    }catch(e:any){
     failed++
     if([404,410].includes(e.statusCode)){await checked(db.from('proc_push_subscriptions').delete().eq('id',s.id));break}
     await checked(db.from('proc_push_deliveries').update({attempts:lease.attempts+1,next_attempt_at:new Date(Date.now()+Math.min(3600000,60000*2**lease.attempts)).toISOString(),last_error:'Push service HTTP '+(e.statusCode||'network failure')}).eq('notification_id',n.id).eq('subscription_id',s.id))
    }
    if(sent+failed>=100)return json({sent,failed})
   }
  }
  return json({sent,failed})
 }catch(_e){return json({error:'Notification service unavailable'},500)}
})
