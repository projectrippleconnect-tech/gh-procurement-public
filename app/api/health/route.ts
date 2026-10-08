export const dynamic = 'force-dynamic'

export async function GET() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL
  const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  const version=process.env.VERCEL_GIT_COMMIT_SHA||process.env.GITHUB_SHA||'local'
  let database='unavailable',schemaReady=false
  try{
    if(url&&key){
      const response=await fetch(url+'/rest/v1/rpc/proc_healthcheck_v1',{
        method:'POST',
        headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:'{}',
        cache:'no-store'
      })
      if(response.ok){
        const data=await response.json()
        database=data?.database||'connected'
        schemaReady=data?.schema_ready===true
      }
    }
  }catch{}
  const ok=database==='connected'&&schemaReady
  return Response.json(
    {ok,app:'GH Procurement',database,schema_ready:schemaReady,version,at:new Date().toISOString()},
    {status:ok?200:503,headers:{'cache-control':'no-store'}}
  )
}
