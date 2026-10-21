import {authorizedWorker,runPortalWorker} from '@/lib/supplier-portal-worker.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 if(!authorizedWorker(request,process.env))return Response.json({error:'Not authorized'},{status:401})
 try{return Response.json(await runPortalWorker(),{headers:{'cache-control':'no-store'}})}
 catch{return Response.json({error:'Worker failed; inspect the portal audit before retrying'},{status:503,headers:{'cache-control':'no-store'}})}
}
