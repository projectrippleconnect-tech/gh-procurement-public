import test from 'node:test'
import assert from 'node:assert/strict'
import {parseCompanySheet,companyImportSubgroup} from '../lib/company-items.mjs'
import {companySectionRows} from '../lib/company-section-tree.mjs'
import {sectionRouteCoverage} from '../lib/company-section-routing.mjs'

test('Alcathine hose items have no subgroup without changing their legacy source keys',()=>{
 const rows=parseCompanySheet({
  title:'ALCATHINE',sheetId:2,
  values:[[],['ALCATHINE HOSE'],['SIZE','100 FT','200 FT'],['1/2"','20','10']]
 })
 assert.equal(rows.length,2)
 assert.deepEqual(rows.map(row=>row.subgroup),['',''])
 assert.ok(rows.every(row=>row.category==='ALCATHINE'&&row.main_group==='ALCATHINE'))
 // The source hash must still be based on original sheet label "ALCATHINE HOSE".
 // Existing imported rows use this identity; changing it creates duplicate items.
 assert.equal(rows[0].source_key,'2:6ridsksvmmsv')
 assert.equal(new Set(rows.map(row=>row.source_key)).size,2)
})
test('normalized app sheets also flatten Alkathine but not unrelated companies',()=>{
 assert.equal(companyImportSubgroup('ALCATINE · App','ALCATHINE HOSE'),'')
 assert.equal(companyImportSubgroup('ALKATHINE','HOSE'),'')
 assert.equal(companyImportSubgroup('ORANGE','SWITCHES'),'SWITCHES')
})
test('Alcathine renders as one root and category supplier route covers direct rows',()=>{
 const sections=[{id:'main',name:'ALCATHINE',active:true,parent_id:null,sort_order:0}]
 const rows=[{id:'row1',section_id:'main',active:true,sort_order:1,item:{description:'ALKATHENE HOSE 1/2IN 100FT',category:'ALCATHINE',main_group:'ALCATHINE',subgroup:''}},
 {id:'row2',section_id:'main',active:true,sort_order:2,item:{description:'ALKATHENE HOSE 1/2IN 200FT',category:'ALCATHINE',main_group:'ALCATHINE',subgroup:''}}]
 const displayed=companySectionRows(rows,sections)
 assert.deepEqual(displayed.filter(x=>x.type==='section').map(x=>x.title),['ALCATHINE'])
 assert.deepEqual(displayed.filter(x=>x.type==='item').map(x=>x.row.id),['row1','row2'])
 assert.deepEqual(sectionRouteCoverage('main',sections,rows,[{section_id:'main',route_mode:'rfq'}]),{directItems:2,totalItems:2,coveredItems:2,overriddenItems:0,descendantSections:0})
})
