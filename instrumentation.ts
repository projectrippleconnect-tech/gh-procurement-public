// Database scheduling owns purchasing deadlines when selected; the web process
// may still run separately approved dispatch. No duplicate idle timer is needed.
export async function register(){
 const processing=process.env.GH_PORTAL_PROCESSING_ENABLED==='true'&&process.env.GH_PORTAL_SCHEDULER_MODE!=='database'
 if(process.env.NEXT_RUNTIME!=='nodejs'||(!processing&&process.env.GH_PORTAL_DISPATCH_ENABLED!=='true'))return
 const {runPortalWorker}=await import('./lib/supplier-portal-worker.mjs')
 let busy=false
 const tick=async()=>{if(busy)return;busy=true;try{await runPortalWorker()}catch{console.error('Supplier portal worker failed; inspect database round and dispatch audits')}finally{busy=false}}
 const timer=setInterval(tick,60_000);timer.unref();void tick()
}
