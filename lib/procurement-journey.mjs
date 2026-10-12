export const STAGES = ['Prepare request', 'Choose prices', 'Send orders']
export function stageForTask(step, view) { return view === 'po' ? 3 : step <= 3 ? 1 : 2 }
export function orderProgress({prepared=false, invitations=[], itemCount=0, pricedCount=0, orders=[]}={}) {
 const active=invitations.filter(x=>x.status!=='declined')
 const sent=active.filter(x=>Boolean(x.sent_at)||x.status==='sent').length
 const placed=orders.filter(x=>x.status!=='cancelled')
 const confirmed=placed.filter(x=>['sent','partially_received','received','closed'].includes(x.status)).length
 const ratio=(n,d)=>d?Math.min(1,n/d):0
 // Completion is based on persisted milestones, never the active interface.
 const percent=Math.round((prepared?20:0)+20*ratio(sent,active.length)+25*ratio(pricedCount,itemCount)+(placed.length?20:0)+15*ratio(confirmed,placed.length))
 const complete=prepared&&active.length>0&&sent===active.length&&itemCount>0&&pricedCount>=itemCount&&placed.length>0&&confirmed===placed.length
 return {percent:complete?100:Math.min(99,percent),sent,suppliers:active.length,confirmed,orders:placed.length,complete}
}
export function sriLankaTimestamp(value) {
 const date=new Date(value)
 return value&&!Number.isNaN(date.getTime())?date.toLocaleString('en-LK',{timeZone:'Asia/Colombo',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—'
}
export const FONT_FIELDS={description:'Item description',size:'Size / variation',reorder:'Reorder level',input:'Stock, quantity & price inputs'}
export const FONT_DEFAULTS={description:14,size:12,reorder:18,input:16,spacing:6}
export function normalizeInterface(value={}) {
 const profile=v=>Object.fromEntries(Object.entries(FONT_DEFAULTS).map(([key,fallback])=>{const n=Number(v?.[key]);return [key,Number.isFinite(n)?Math.max(key==='spacing'?2:12,Math.min(key==='spacing'?14:24,n)):fallback]}))
 return {mobile:profile(value?.mobile),desktop:profile(value?.desktop)}
}
export function interfaceVariables(value={}) {
 const settings=normalizeInterface(value)
 return Object.fromEntries(Object.entries(settings).flatMap(([device,values])=>Object.entries(values).map(([key,n])=>['--'+device+'-'+key,n+'px'])))
}
