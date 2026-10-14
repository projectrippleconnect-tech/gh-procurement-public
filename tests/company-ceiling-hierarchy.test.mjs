import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompanySheet} from '../lib/company-items.mjs'
import {PANEL_CEILING_PATHS,withPanelCeilingPaths,reconcilePanelCeilingSections} from '../lib/company-ceiling-hierarchy.mjs'

const source=[
 [],['GI CHANNEL'],['SIZE'],['GI Channel 35mm','200'],[],[],[],
 ['CEILING FITTINGS','WHITE PLAIN','BLACK LINE','TEAK'],
 ['DESCRIPTION','PLAIN','BLACK LINE','PLAIN','BLACK LINE'],
 ['Ceiling Main Tee 12ft','100','150','50',''],
 ['Ceiling Cross Tee 12ft','250','350','150',''],
 ['Ceiling Wall Angle 10ft','200','0','50',''],
 [],['I PANEL','SIZE'],['DESCRIPTION',"10'","12'"],['I Panel Teak','50','50']
]
const parse=values=>parseCompanySheet({title:'PANEL SHEETS',sheetId:987,values})

test('three nested finish groups map each ceiling item to the correct path',()=>{
 const rows=parse(source)
 const fittings=rows.filter(r=>r.section_path)
 assert.equal(fittings.length,12)
 for(const [col,path] of Object.entries(PANEL_CEILING_PATHS)){
  const group=fittings.filter(r=>r.source_position?.endsWith(':'+col))
  assert.equal(group.length,3)
  assert.equal(group.every(r=>r.section_path===path),true)
 }
 assert.equal(fittings.some(r=>r.description==='CEILING FITTINGS'),false)
 assert.equal(rows.some(r=>r.description.includes('I Panel Teak')),true)
})

test('stock targets, zero, blank review and source ids are preserved across refresh',()=>{
 const original=parse(source)
 const fitting=original.filter(r=>r.section_path)
 const byPosition=new Map(fitting.map(r=>[r.source_position,r]))
 assert.equal(byPosition.get('987:10:2').max_stock,100)
 assert.equal(byPosition.get('987:10:3').max_stock,150)
 assert.equal(byPosition.get('987:10:4').max_stock,50)
 assert.equal(byPosition.get('987:10:5').max_stock,null)
 assert.equal(byPosition.get('987:10:5').max_stock_review,true)
 assert.equal(byPosition.get('987:12:3').max_stock,0)
 const changed=source.map(r=>[...r])
 changed[9][1]='99'
 const refreshed=parse(changed).filter(r=>r.section_path)
 assert.deepEqual(refreshed.map(r=>r.source_key),fitting.map(r=>r.source_key))
 assert.equal(refreshed.find(r=>r.source_position==='987:10:2').max_stock,99)
})

test('other suppliers are not categorized from similar column positions',()=>{
 const rows=[{subgroup:'CEILING FITTINGS',source_position:'9:10:3',description:'Some product',source_key:'id'}]
 assert.equal(withPanelCeilingPaths(rows,'ORANGE'),rows)
})

test('reconcile rejects unrelated companies without database writes',async()=>{
 const never={from(){throw Error('unexpected write')}}
 assert.deepEqual(await reconcilePanelCeilingSections(never,{name:'ORANGE'},[{section_path:PANEL_CEILING_PATHS[2]}]),
  {created:0,moved:0,matched:0,skipped:0})
})
