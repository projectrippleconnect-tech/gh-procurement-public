import test from 'node:test'
import assert from 'node:assert/strict'
import {buildReviewedPlan} from '../lib/reviewed-company-sync.mjs'
import {legacyAlignment,verifiedLegacyCandidate} from '../lib/reviewed-legacy-matcher.mjs'

function fixture({max=20,colour='WHITE',order=0,old='1 GANG 1 WAY',brand='KEVILTON',source='COMPANY SHEET'}={}){
 const sourceRow={source_key:'295110924:new-hash',source_position:'295110924:2:2',brand:'KEVILTON',colour:'WHITE',max_stock:20}
 const link={id:'link-a',item_id:'item-a',company_id:'company-a',sort_order:order,source_key:'295110924:original-hash',source_sheet_id:295110924,target_stock:max,active:true,max_stock_review:false,
  item:{id:'item-a',source,description:old,category:'KEVILTON',main_group:'KEVILTON',subgroup:'KEVILTON WHITE',brand,colour,size:null,variation:null,uom:'PCS'}}
 const values=[[],['Kevilton 1 Gang 1-Way Switch - White','20','1 GANG 1-WAY SWITCH WHITE KEVILTON','SWITCHES','WHITE','MODULAR']]
 return {sourceRow,link,values}
}
const plan=(sourceRow,link,values)=>buildReviewedPlan({title:'KEVILTON',sheetId:295110924,values,parsedRows:[sourceRow],links:[link]})

test('legacy name with verified position, quantity, brand, colour matches old ID without rekeying',()=>{
 const {sourceRow,link,values}=fixture()
 const result=plan(sourceRow,link,values)
 assert.equal(result.stats.verifiedLegacyMatches,1)
 assert.equal(result.stats.sourceKeyMatches,0)
 assert.equal(result.changes[0].id,'item-a')
 assert.equal(result.changes[0].link_id,'link-a')
 assert.equal(result.changes[0].matchMethod,'verified_legacy')
 assert.equal(result.changes[0].patch.description,'1 GANG 1-WAY SWITCH WHITE KEVILTON')
 assert.equal(result.changes[0].patch.main_group,'SWITCHES')
 assert.equal(result.changes[0].patch.subgroup,'WHITE')
 assert.equal(Object.hasOwn(result.changes[0].patch,'target_stock'),false)
 assert.equal(Object.hasOwn(result.changes[0].patch,'source_key'),false)
})
test('quantity mismatch disables legacy fallback and does not match by order alone',()=>{
 const {sourceRow,link,values}=fixture({max:30})
 const result=plan(sourceRow,link,values)
 assert.equal(result.stats.verifiedLegacyMatches,0)
 assert.equal(result.stats.unmatched,1)
})
test('brand mismatch, colour mismatch, deleted record and broken ordering prevent fallback',()=>{
 for(const options of [{colour:'BLACK'},{brand:'OTHER'},{source:'OTHER'},{order:10}]){
  const {sourceRow,link,values}=fixture(options)
  const result=plan(sourceRow,link,values)
  assert.equal(result.stats.matched,0,JSON.stringify(options))
 }
})
test('typo-only one-token overlap cannot silently rename an unrelated product',()=>{
 const {sourceRow,link,values}=fixture({old:'BELL PREO'})
 const result=plan(sourceRow,link,values)
 assert.equal(result.stats.unmatched,1)
})
test('list length discrepancy prevents rank fallback, even with identical max stock',()=>{
 const {sourceRow,link,values}=fixture()
 const another={...sourceRow,source_key:'295110924:extra',source_position:'295110924:3:2'}
 const result=buildReviewedPlan({title:'KEVILTON',sheetId:295110924,values,parsedRows:[sourceRow,another],links:[link]})
 assert.equal(result.stats.verifiedLegacyMatches,0)
})
test('legacy rank recovery is disabled for complex multi-brand wire matrices',()=>{
 const {sourceRow,link}=fixture()
 const ordered=legacyAlignment({title:'WIRE CABLES',sheetId:295110924,parsedRows:[sourceRow],links:[link]})
 assert.equal(ordered,null)
 assert.equal(verifiedLegacyCandidate({row:sourceRow,index:0,reviewedName:'TEST',ordered,sheetId:295110924}),null)
})
