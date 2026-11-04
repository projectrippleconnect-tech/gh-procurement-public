import {createHash} from 'node:crypto'
import {companyAccess,companyBody,companyReply,sheetsToken,sheetsRequest} from '@/lib/company-server'
// @ts-ignore Existing worksheet parser has Node unit tests.
import {parseCompanySheet,validateCompanyImport} from '@/lib/company-items.mjs'
// @ts-ignore Pure reconciliation functions are covered by dedicated tests.
import {buildReviewedPlan,legacySheetValues} from '@/lib/reviewed-company-sync.mjs'

export const runtime='nodejs'
export const dynamic='force-dynamic'
type Change={id:string;matchMethod:'source_key'|'verified_legacy';old:{description:string;main_group:string|null;subgroup:string|null};patch:{description?:string;main_group?:string;subgroup?:string}}
const MAX_APPLY=25

export async function POST(request:Request){
 try{
  // Uses the real user JWT and existing company_lists.manage guard.
  const {db}=await companyAccess(request,true),body=await companyBody(request)
  if(!['preview','apply'].includes(body.action)||typeof body.companyId!=='string')
   throw new Error('Choose a company and preview or apply.')
  const {data:company,error:companyError}=await db.from('proc_companies')
   .select('id,name,sheet_id').eq('id',body.companyId).single()
  if(companyError||company?.sheet_id===null||company?.sheet_id===undefined)
   throw new Error('Selected company is not linked to the reviewed source sheet.')
  const token=await sheetsToken()
  const book=await sheetsRequest(token,'?fields=sheets(properties(sheetId,title,hidden,gridProperties(rowCount)))')
  const sheet=book.sheets?.find((x:{properties:{sheetId:number;hidden?:boolean}})=>x.properties.sheetId===company.sheet_id)
  if(!sheet||sheet.properties.hidden)throw new Error('The original linked company sheet was not found.')
  const title=String(sheet.properties.title||'').trim()
  const range="'"+String(sheet.properties.title).replaceAll("'","''")+"'!A1:Q"+Math.max(100,Number(sheet.properties.gridProperties?.rowCount)||100)
  const response=await sheetsRequest(token,'/values/'+encodeURIComponent(range)+'?valueRenderOption=FORMATTED_VALUE')
  const values=response.values||[]
  const rows=validateCompanyImport(parseCompanySheet({
   title,sheetId:company.sheet_id,values:legacySheetValues(title,values)
  }))
  const {data:links,error:linksError}=await db.from('proc_company_list_items')
   .select('id,item_id,source_key,source_sheet_id,sort_order,target_stock,max_stock_review,active,item:proc_items(id,description,main_group,subgroup,brand,size,colour,variation,uom,source)')
   .eq('company_id',company.id).limit(1000)
  if(linksError)throw linksError
  if((links||[]).length>=1000)throw new Error('Company list exceeds the safe reconciliation limit.')
  const plan=buildReviewedPlan({title,sheetId:company.sheet_id,values,parsedRows:rows,links:links||[]})
  const changes=plan.changes as Change[]
  // Fingerprints the DB-before and Sheet-after proposal. Old previews cannot
  // apply if either changes, and each named item must have an exact old description.
  const fingerprint=createHash('sha256').update(JSON.stringify({companyId:company.id,sheetId:company.sheet_id,changes})).digest('hex')
  const result={
   ok:true,company:company.name,stats:plan.stats,
   unmatchedSample:plan.unmatched.slice(0,12),
   previewSample:changes.slice(0,12).map((x:Change)=>({id:x.id,from:x.old.description,to:x.patch.description||x.old.description,category:x.patch.main_group||x.old.main_group,matchMethod:x.matchMethod}))
  }
  if(body.action==='preview')return companyReply({...result,fingerprint,message:'Preview only; no app records changed.'})
  if(typeof body.fingerprint!=='string'||body.fingerprint!==fingerprint)
   throw new Error('The catalogue or app records changed. Preview again before applying.')
  if(!changes.length)return companyReply({...result,applied:0,message:'No safe identity-matched changes pending.'})
  if(changes.slice(0,MAX_APPLY).some(x=>x.matchMethod==='verified_legacy')&&body.ackLegacy!==true)
   throw new Error('Confirm the reviewed legacy-item matches before applying.');
  let applied=0
  const errors:string[]=[]
  // No inserts, deletes, source-key rewrites, quantity updates or privileged SQL.
  // Row level security and audit triggers continue to apply.
  for(const c of changes.slice(0,MAX_APPLY)){
   const {data,error}=await db.from('proc_items').update(c.patch).eq('id',c.id)
    .eq('source','COMPANY SHEET').eq('description',c.old.description).select('id')
   if(error||!data?.length){errors.push(c.id+': '+(error?.message||'record changed; refresh preview'));break}
   applied++
  }
  return companyReply({
   ...result,ok:errors.length===0,applied,remaining:Math.max(0,changes.length-applied),errors,
   message:errors.length?'Stopped at the first conflict; preview again.':applied+' existing item records updated. Preview again for remaining changes.'
  },errors.length?207:200)
 }catch(e){
  return companyReply({ok:false,error:e instanceof Error?e.message:'Reviewed sync failed.'},400)
 }
}
