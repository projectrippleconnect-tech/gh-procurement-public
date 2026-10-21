// Runs within the existing web service; no new paid scheduler or hosting resource.
export async function register(){
 if(process.env.NEXT_RUNTIME!=='nodejs'||(process.env.GH_PORTAL_PROCESSING_ENABLED!=='true'&&process.env.GH_PORTAL_DISPATCH_ENABLED!=='true'))return
 const {runPortalWorker}=await import('./lib/supplier-portal-worker.mjs')
 let busy=false
 const tick=async()=>{if(busy)return;busy=true;try{await runPortalWorker()}catch{console.error('Supplier portal worker failed; inspect database round and dispatch audits')}finally{busy=false}}
 const timer=setInterval(tick,60_000);timer.unref();void tick()
}
