// Read-only stock history helpers. No changes to the stock-count transaction.
export async function latestStockMarkers(client,itemIds,companyId=null,{signal,concurrency=3}={}){
 const ids=[...new Set((itemIds||[]).filter(Boolean))],latest={}
 let cursor=0
 const check=()=>{if(signal?.aborted)throw new DOMException('History check cancelled','AbortError')}
 await Promise.all(Array.from({length:Math.min(concurrency,Math.ceil(ids.length/300))},async()=>{
  while(cursor<ids.length){
   check()
   const start=cursor;cursor+=300
   let request=client.rpc('proc_stock_latest_item_submissions_v1',{p_item_ids:ids.slice(start,start+300),p_company_id:companyId})
   if(signal&&request.abortSignal)request=request.abortSignal(signal)
   const {data,error}=await request
   check();if(error)throw error
   for(const line of data||[])latest[line.item_id]=line
  }
 }))
 return latest
}
export function submissionQuantity(row){
 if(row?.sufficient_stock)return 'Sufficient (exact quantity not counted)'
 return row?.current_stock==null?'Not recorded':String(row.current_stock)
}
export function stockSubmissionDate(iso){
 if(!iso)return '—'
 const date=new Date(iso)
 if(Number.isNaN(date.getTime()))return '—'
 return new Intl.DateTimeFormat('en-LK',{
  timeZone:'Asia/Colombo',year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true
 }).format(date)
}

// This list is independent of current stock filters and keeps Company lots separate.
export function generalStockHistoryRows(rows=[]){
 return (Array.isArray(rows)?rows:[]).filter(row=>!String(row?.category||'').trim().toUpperCase().startsWith('COMPANY:'))
}
