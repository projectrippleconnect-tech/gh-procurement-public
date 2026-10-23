import {createClient} from '@supabase/supabase-js'
import {otpGateway} from '@/lib/supplier-otp.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}})
export async function GET(request){
 const token=(request.headers.get('authorization')||'').match(/^Bearer (.+)$/i)?.[1]
 if(!token)return reply({error:'Staff sign-in required'},401)
 const env=process.env,url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY
 if(!url||!key)return reply({error:'Staff verification unavailable'},503)
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}})
 const {error}=await db.rpc('proc_supplier_document_settings_v1')
 if(error)return reply({error:'RFQ management permission and portal setup required'},403)
 const gateway=otpGateway(env)
 let connected=false
 if(gateway){try{const r=await fetch(gateway.base+'/api/sessions/'+gateway.session,{headers:{'X-Api-Key':gateway.key},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});connected=r.ok&&(await r.json()).status==='WORKING'}catch{}}
 return reply({configured:Boolean(gateway),connected,verificationRequired:true,
  otpEnabled:connected&&Boolean(env.SUPABASE_SERVICE_ROLE_KEY)&&env.GH_PORTAL_OTP_SENDING_ENABLED==='true',
  dispatchEnabled:connected&&env.GH_PORTAL_DELIVERY_VERIFIED==='true'&&env.GH_PORTAL_DISPATCH_ENABLED==='true'&&env.WAHA_SENDING_ENABLED==='true',
  deliveryVerified:env.GH_PORTAL_DELIVERY_VERIFIED==='true',
  networkMismatch:Boolean(env.NETLIFY&&gateway?.base.includes('.railway.internal'))})
}
