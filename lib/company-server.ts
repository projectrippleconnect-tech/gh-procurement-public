import {createClient} from '@supabase/supabase-js'
import {createSign} from 'node:crypto'
export async function companyAccess(request:Request,admin=false){
 const token=(request.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1]
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 if(!token||!url||!key)throw new Error('Sign in to GH Procurement.')
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:'Bearer '+token}}})
 const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw new Error('Your session has expired.')
 const {data:profile}=await db.from('proc_profiles').select('role,active').eq('id',user.id).single()
 const {data:permissions,error:permissionError}=await db.rpc('proc_my_permissions_v1')
 if(permissionError||!profile?.active||!Array.isArray(permissions)||!permissions.some((p: string|{permission_key:string})=>(typeof p==='string'?p:p.permission_key)===(admin?'company_lists.manage':'company_lists.view'))||(admin&&profile.role!=='admin'))throw new Error('Company permission required.')
 return {db,user}
}
export const companyReply=(data:object,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}})
export async function companyBody(request:Request){const text=await request.text();if(text.length>10000)throw new Error('Request too large.');return JSON.parse(text)}
export async function sheetsToken(){
 const raw=process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
 if(!raw)throw new Error('Google Sheets connection needs a service account. Configure it and share the Company Items sheet with that account.')
 let account;try{account=JSON.parse(raw)}catch{throw new Error('Google Sheets credentials are not valid JSON.')} if(!account.client_email||!account.private_key)throw new Error('Google Sheets credentials are incomplete.')
 const now=Math.floor(Date.now()/1000),encode=(v:object)=>Buffer.from(JSON.stringify(v)).toString('base64url')
 const jwt=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3500})
 const signer=createSign('RSA-SHA256');signer.update(jwt);const assertion=jwt+'.'+signer.sign(account.private_key,'base64url')
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(15000)})
 if(!response.ok)throw new Error('Could not authenticate the Google Sheets connection.');const result=await response.json();return result.access_token as string
}
export async function sheetsRequest(token:string,path:string,body?:object){
 const id=process.env.COMPANY_ITEMS_SPREADSHEET_ID
 if(!id||!/^[\w-]{15,100}$/.test(id))throw new Error('Configure COMPANY_ITEMS_SPREADSHEET_ID first.')
 const response=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+id+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(30000)})
 if(!response.ok)throw new Error('Google Sheets request failed (HTTP '+response.status+'). Check sharing and configuration.')
 return response.json()
}
