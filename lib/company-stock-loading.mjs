import {allRows} from './query-pages.js'
import {latestStockMarkers} from './stock-item-history.mjs'

// Independent catalogues must not wait for each other's network round trips.
export async function loadCompanyStockCatalogue(client,companyIds,signal){
 if(!companyIds.length)return {rows:[],sections:[]}
 const scope=query=>(companyIds.length===1?query.eq('company_id',companyIds[0]):query.in('company_id',companyIds)).abortSignal(signal)
 const [items,sections]=await Promise.all([
  allRows(()=>scope(client.from('proc_company_list_items').select('*,item:proc_items(id,item_code,description,size,uom,movement,category,main_group,subgroup,brand,colour,variation,remarks)')).eq('active',true).order('company_id').order('sort_order').order('id')),
  allRows(()=>scope(client.from('proc_company_sections').select('id,company_id,parent_id,name,sort_order,color,active')).eq('active',true).order('sort_order').order('id'))
 ])
 if(items.error)throw items.error
 if(sections.error&&!['PGRST205','42P01'].includes(sections.error.code))throw sections.error
 return {rows:items.data||[],sections:sections.data||[]}
}

// Bound network fan-out while preserving company scope and the 300-item RPC cap.
export async function loadCompanyStockMarkers(client,rows){
 const grouped=new Map()
 for(const row of rows){
  if(!grouped.has(row.company_id))grouped.set(row.company_id,[])
  grouped.get(row.company_id).push(row.item_id)
 }
 const groups=[...grouped],latest={}
 let cursor=0,failed=false
 await Promise.all(Array.from({length:Math.min(4,groups.length)},async()=>{
  while(!failed&&cursor<groups.length){
   const [companyId,ids]=groups[cursor++]
   try{
    const markers=await latestStockMarkers(client,ids,companyId)
    for(const [itemId,marker] of Object.entries(markers))latest[companyId+'|'+itemId]=marker
   }catch(error){failed=true;throw error}
  }
 }))
 return latest
}
