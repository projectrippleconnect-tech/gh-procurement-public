// GH Procurement offline stock journal. All records are scoped to the signed-in user.
// No success is reported until the IndexedDB transaction has committed.
const DB_NAME='gh-procurement-stock-offline'
const VERSION=1
const OPERATIONS='operations',SNAPSHOTS='snapshots'
export const OFFLINE_CHANGED='gh-offline-stock-changed'
let openPromise=null
const activeFlushes=new Map()

function browserDb(){
 if(typeof indexedDB==='undefined')throw new Error('Offline storage is unavailable in this browser. Keep this page open and try again online.')
 if(!openPromise){
  openPromise=new Promise((resolve,reject)=>{
   const request=indexedDB.open(DB_NAME,VERSION)
   request.onupgradeneeded=()=>{
    const db=request.result
    if(!db.objectStoreNames.contains(OPERATIONS))db.createObjectStore(OPERATIONS,{keyPath:'id'})
    if(!db.objectStoreNames.contains(SNAPSHOTS))db.createObjectStore(SNAPSHOTS,{keyPath:'key'})
   }
   request.onsuccess=()=>resolve(request.result)
   request.onerror=()=>reject(request.error||new Error('Offline database could not open.'))
   request.onblocked=()=>reject(new Error('Offline database upgrade blocked. Close other GH Procurement tabs and retry.'))
  }).catch(e=>{openPromise=null;throw e})
 }
 return openPromise
}
async function transact(store,mode,action){
 const db=await browserDb()
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(store,mode)
  let answer
  tx.oncomplete=()=>resolve(answer)
  tx.onerror=()=>reject(tx.error||new Error('Offline save failed.'))
  tx.onabort=()=>reject(tx.error||new Error('Offline save aborted.'))
  try{
   const request=action(tx.objectStore(store))
   if(request){request.onsuccess=()=>{answer=request.result};request.onerror=()=>{ /* transaction.onerror handles it */ }}
  }catch(e){tx.abort();reject(e)}
 })
}
function changed(){
 if(typeof window!=='undefined')window.dispatchEvent(new Event(OFFLINE_CHANGED))
}
export function isDisconnected(){
 return typeof navigator!=='undefined'&&navigator.onLine===false
}
export async function saveStockSnapshot(ownerId,key,value){
 if(!ownerId||!key)throw new Error('Cannot cache stock data without a user and cache key.')
 await transact(SNAPSHOTS,'readwrite',store=>store.put({key:ownerId+':'+key,ownerId,value,updatedAt:new Date().toISOString()}))
}
export async function readStockSnapshot(ownerId,key){
 if(!ownerId||!key)return null
 const row=await transact(SNAPSHOTS,'readonly',store=>store.get(ownerId+':'+key))
 return row?.ownerId===ownerId?row:null
}
export function validateStockSubmission(input){
 if(!input?.ownerId||!['general','company'].includes(input?.kind))throw new Error('Invalid offline stock submission.')
 if(!Array.isArray(input.lines)||!input.lines.length||input.lines.length>1000)throw new Error('Stock submission must contain 1–1000 items.')
 if(input.kind==='company'&&!input.companyId)throw new Error('Choose a company first.')
 const ids=new Set()
 for(const line of input.lines){
  const id=input.kind==='company'?line.company_list_item_id:line.item_id
  if(typeof id!=='string'||!id||ids.has(id))throw new Error('Invalid or duplicated stock item.')
  ids.add(id)
  if(line.sufficient_stock!==true&&(!Number.isFinite(line.current_stock)||line.current_stock<0))throw new Error('Invalid counted stock.')
 }
 return true
}
export async function enqueueStockSubmission(input){
 validateStockSubmission(input)
 if(!globalThis.crypto?.randomUUID)throw new Error('Secure operation identifiers are unavailable.')
 const operation={
  id:crypto.randomUUID(),
  ownerId:input.ownerId,kind:input.kind,companyId:input.companyId||null,
  category:input.category||'',lines:input.lines,startedAt:input.startedAt||null,
  resetRevisions:{stock:String(input.resetRevisions?.stock??''),procurement:String(input.resetRevisions?.procurement??'')},
  createdAt:new Date().toISOString()
 }
 await transact(OPERATIONS,'readwrite',store=>store.add(operation))
 changed()
 return operation
}
export async function pendingStockSubmissions(ownerId){
 if(!ownerId)return []
 const rows=await transact(OPERATIONS,'readonly',store=>store.getAll())
 return (rows||[]).filter(x=>x.ownerId===ownerId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))
}
export async function pendingStockCount(ownerId){
 return (await pendingStockSubmissions(ownerId)).length
}
async function acknowledge(id){
 await transact(OPERATIONS,'readwrite',store=>store.delete(id))
 changed()
}
async function uploadOperation(op,supabase,{allowDispatch=false}={}){
 const payload={
  p_operation_id:op.id,p_kind:op.kind,p_lines:op.lines,
  p_company_id:op.companyId,p_category:op.category,p_started_at:op.startedAt,
  p_reset_revisions:op.resetRevisions||{}
 }
 if(op.kind==='general'){
  const result=await supabase.rpc('proc_submit_offline_stock_v1',payload)
  if(result.error)throw result.error
  return result.data
 }
 const {data:{session}}=await supabase.auth.getSession()
 if(!session?.access_token)throw new Error('Sign in again to synchronize Company Item counts.')
 const response=await fetch('/api/company-items/submit',{
  method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
  body:JSON.stringify({operationId:op.id,companyId:op.companyId,lines:op.lines,startedAt:op.startedAt,resetRevisions:op.resetRevisions||{},allowDispatch})
 })
 const data=await response.json().catch(()=>null)
 if(!response.ok||data?.ok===false)throw new Error(data?.error||'Company stock sync rejected.')
 return data
}
export async function synchronizeStockSubmissions(ownerId,supabase,{allowDispatchFor=[]}={}){
 if(!ownerId||isDisconnected())return {completed:0,pending:ownerId?await pendingStockCount(ownerId):0,offline:true}
 if(activeFlushes.has(ownerId)){
  await activeFlushes.get(ownerId)
  return synchronizeStockSubmissions(ownerId,supabase,{allowDispatchFor})
 }
 const execute=async()=>{
  let completed=0,error=''
  const completedIds=[],receipts={}
  for(const op of await pendingStockSubmissions(ownerId)){
   if(isDisconnected())break
   try{
    const response=await uploadOperation(op,supabase,{allowDispatch:allowDispatchFor.includes(op.id)})
    await acknowledge(op.id)
    completed++
    completedIds.push(op.id)
    receipts[op.id]=response
   }catch(e){
    // Never discard a submission on timeout, auth failure, or an ambiguous response.
    // Server-side operation IDs make retries safe even if the first response was lost.
    error=e?.message||'Synchronization failed.'
    break
   }
  }
  return {completed,completedIds,receipts,pending:await pendingStockCount(ownerId),offline:isDisconnected(),error}
 }
 const task=(async()=>{
  if(typeof navigator!=='undefined'&&navigator.locks?.request){
   return navigator.locks.request('gh-stock-sync:'+ownerId,{mode:'exclusive'},execute)
  }
  return execute()
 })().finally(()=>{activeFlushes.delete(ownerId);changed()})
 activeFlushes.set(ownerId,task)
 return task
}
