import {companyAccess,companyBody,companyReply,sheetsToken,sheetsRequest} from '@/lib/company-server'
// @ts-ignore Shared worksheet parser is covered by node tests.
import {parseCompanySheet,validateCompanyImport} from '@/lib/company-items.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 try{
  const {db}=await companyAccess(request,true),body=await companyBody(request),token=await sheetsToken()
  const book=await sheetsRequest(token,'?fields=sheets(properties,developerMetadata)')
  if(body.action==='import'){
   let imported=0;const errors:string[]=[]
   for(const sheet of book.sheets||[]){
    const {sheetId,title,gridProperties}=sheet.properties
    if(sheet.properties.hidden)continue
    const range="'"+title.replaceAll("'","''")+"'!A1:"+columnLabel(gridProperties.columnCount)+gridProperties.rowCount
    try{
     const values=await sheetsRequest(token,'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE')
     let rows
     if(values.values?.[0]?.[0]==='Source ID')rows=normalizedRows(values.values,sheetId,title)
     else rows=parseCompanySheet({title,sheetId,values:values.values||[]})
     validateCompanyImport(rows)
     let importTitle=title.replace(/ · App$/,'');const owner=sheet.developerMetadata?.find((m:{metadataKey:string})=>m.metadataKey==='gh_company_id')?.metadataValue;if(owner){const found=await db.from('proc_companies').select('name').eq('id',owner).maybeSingle();if(found.error)throw found.error;if(found.data)importTitle=found.data.name}
     const r=await db.rpc('proc_company_import_sheet',{p_title:importTitle,p_sheet_id:sheetId,p_rows:rows});if(r.error)throw r.error;imported+=r.data.imported
    }catch(e){errors.push(title+': '+(e instanceof Error?e.message:'Import failed'))}
   }
   return companyReply({ok:errors.length===0,message:imported+' new company items imported.'+(errors.length?' Review: '+errors.join('; '):''),errors},errors.length?207:200)
  }
  if(body.action!=='publish'||!body.companyId)throw new Error('Choose import or publish.')
  const {data:company,error}=await db.from('proc_companies').select('*').eq('id',body.companyId).single();if(error)throw error
  const {data:items,error:itemsError}=await db.from('proc_company_list_items').select('*,item:proc_items(*)').eq('company_id',company.id).eq('active',true).order('sort_order');if(itemsError)throw itemsError
  // App-managed export is separate from handwritten matrices, preserving source cell identities.
  const title=(company.sheet_id!==null?company.name+' · App':company.name).slice(0,100)
  const existing=book.sheets?.find((s:{properties:{title:string;sheetId:number}})=>company.export_sheet_id!==null?s.properties.sheetId===company.export_sheet_id:s.properties.title===title)
  let sheetId=existing?.properties.sheetId
  if(existing&&!existing.developerMetadata?.some((m:{metadataKey:string;metadataValue:string})=>m.metadataKey==='gh_company_id'&&m.metadataValue===company.id))throw new Error('This tab is maintained outside the app. Import it first or choose a different company name; it has not been overwritten.')
  if(sheetId===undefined){
   const added=await sheetsRequest(token,':batchUpdate',{requests:[{addSheet:{properties:{title}}}]});sheetId=added.replies[0].addSheet.properties.sheetId
   await sheetsRequest(token,':batchUpdate',{requests:[{createDeveloperMetadata:{developerMetadata:{metadataKey:'gh_company_id',metadataValue:company.id,visibility:'DOCUMENT',location:{sheetId}}}}]})
  }
  const rows=[['Source ID','Description','Category','Main group','Subcategory','Brand','Size','Colour','Variation','UOM','Movement','Maximum stock','Reorder level','Remarks'],...(items||[]).map(r=>[r.source_key||'app:'+r.id,r.item.description,r.item.category,r.item.main_group||'',r.item.subgroup||'',r.item.brand||'',r.item.size||'',r.item.colour||'',r.item.variation||'',r.item.uom,r.item.movement,r.max_stock_review?'':r.target_stock,r.max_stock_review?'':r.reorder_level??r.target_stock*.5,r.item.remarks||''])]
  const cellRows=rows.map(row=>({values:row.map(v=>({userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}}))}))
  await sheetsRequest(token,':batchUpdate',{requests:[{updateSheetProperties:{properties:{sheetId,title,gridProperties:{rowCount:Math.max(rows.length,1000),columnCount:14,frozenRowCount:1}},fields:'title,gridProperties'}},{updateCells:{range:{sheetId},rows:cellRows,fields:'userEnteredValue'}}]})
  const saved=await db.from('proc_companies').update({export_sheet_id:sheetId}).eq('id',company.id);if(saved.error)throw saved.error
  return companyReply({ok:true,message:'Company tab published to Google Sheets.'})
 }catch(e){return companyReply({ok:false,error:e instanceof Error?e.message:'Company sheet sync failed.'},400)}
}
function columnLabel(n:number){let label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26)}return label}
function normalizedRows(values:unknown[][],sheetId:number,title:string){return values.slice(1).filter(r=>r[1]).map((r,index)=>({source_key:String(r[0]||sheetId+':'+(index+2)),source_sheet_id:sheetId,source_tab:title,description:String(r[1]),category:String(r[2]||title),main_group:String(r[3]||''),subgroup:String(r[4]||''),brand:String(r[5]||''),size:String(r[6]||''),colour:String(r[7]||''),variation:String(r[8]||''),uom:String(r[9]||'PCS'),movement:String(r[10]||'NORMAL'),max_stock:r[11]===''||r[11]===undefined?null:Number(r[11]),remarks:String(r[13]||'')}))}
