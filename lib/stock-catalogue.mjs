// Keep the stock catalogue warm across opening/closing the search panel.
// Retry transient database timeouts without ever treating a partial page as complete.
export const STOCK_CATALOGUE_PAGE_SIZE=250

export function isTransientStockQueryError(error){
 const message=String(error?.message||error||'').toLowerCase()
 return error?.code==='57014'||/statement timeout|fetch failed|failed to fetch|networkerror|timed out|timeout/.test(message)
}

export async function retryStockQuery(operation,{maxRetries=2,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 for(let attempt=0;;attempt++){
  try{return await operation()}
  catch(error){
   if(attempt>=maxRetries||!isTransientStockQueryError(error))throw error
   await wait(200*(2**attempt))
  }
 }
}

export async function loadStockCatalogue({fetchPage,onPage=()=>{},signal,pageSize=STOCK_CATALOGUE_PAGE_SIZE,maxRetries=2,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 if(!Number.isInteger(pageSize)||pageSize<1)throw new Error('Invalid stock catalogue page size')
 const rows=[]
 for(let offset=0;;offset+=pageSize){
  if(signal?.aborted)return null
  let page
  for(let attempt=0;;attempt++){
   try{
    page=await fetchPage(offset,offset+pageSize-1,signal)
    if(signal?.aborted)return null
    if(!Array.isArray(page))throw new Error('Stock catalogue returned invalid data')
    break
   }catch(error){
    if(signal?.aborted)return null
    if(attempt>=maxRetries||!isTransientStockQueryError(error))throw error
    await wait(200*(2**attempt))
   }
  }
  rows.push(...page)
  if(signal?.aborted)return null
  onPage(rows)
  if(page.length<pageSize)return rows
 }
}
