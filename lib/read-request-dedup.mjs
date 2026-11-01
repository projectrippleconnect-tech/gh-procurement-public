// Share simultaneous identical reads only. No response cache or mutation retries.
// Authorization and every request header form part of the key; signals stay independent.
const READ_RPCS=new Set(['proc_item_filter_options_v1','proc_my_permissions_v1','proc_workspace_bootstrap_v1'])
export function deduplicatedReads(fetcher){
 const pending=new Map()
 return async(input,init={})=>{
  if(typeof input!=='string'&&!(input instanceof URL))return fetcher(input,init)
  const url=new URL(String(input)),method=(init.method||'GET').toUpperCase()
  const eligible=url.pathname.startsWith('/rest/v1/')&&(method==='GET'||(method==='POST'&&READ_RPCS.has(url.pathname.split('/').pop())))
  if(!eligible||init.signal)return fetcher(input,init)
  const headers=[...new Headers(init.headers).entries()].sort(([a],[b])=>a.localeCompare(b))
  const key=JSON.stringify([String(url),method,headers,init.body||''])
  let work=pending.get(key)
  if(!work){
   work=Promise.resolve().then(()=>fetcher(input,init)).finally(()=>{if(pending.get(key)===work)pending.delete(key)})
   pending.set(key,work)
  }
  return (await work).clone()
 }
}
