import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultSectionRoute,nearestSectionRoute,validateSectionRoute,sectionRouteCoverage,companyAutomationScope} from '../lib/company-section-routing.mjs'

test('one designated supplier defaults to direct order and auto-send; multiple to RFQ',()=>{
 assert.deepEqual(defaultSectionRoute(1),{mode:'direct',autoSend:true})
 assert.deepEqual(defaultSectionRoute(2),{mode:'rfq',autoSend:false})
 assert.deepEqual(defaultSectionRoute(3),{mode:'rfq',autoSend:false})
})
test('RFQ supports one or more suppliers, and never auto-sends a PO',()=>{
 assert.deepEqual(validateSectionRoute({mode:'rfq',supplierIds:['s1','s2','s3'],autoSend:true}),{valid:true,mode:'rfq',supplierIds:['s1','s2','s3'],autoSend:true})
 assert.equal(validateSectionRoute({mode:'rfq',supplierIds:['s1'],autoSend:false}).valid,true)
})
test('direct routes reject multiple and missing supplier IDs',()=>{
 assert.equal(validateSectionRoute({mode:'direct',supplierIds:['s1','s2'],autoSend:true}).valid,false)
 assert.equal(validateSectionRoute({mode:'direct',supplierIds:[]}).valid,false)
 assert.deepEqual(validateSectionRoute({mode:'direct',supplierIds:['s1','s1'],autoSend:true}),
  {valid:true,mode:'direct',supplierIds:['s1'],autoSend:true})
})
test('nested item sections inherit the closest configured parent and allow overrides',()=>{
 const sections=[{id:'root',parent_id:null},{id:'alkathene',parent_id:'root'},{id:'pipes',parent_id:'alkathene'}]
 const rules=[{section_id:'root',route_mode:'direct',supplier_id:'s1'},{section_id:'alkathene',route_mode:'rfq',supplier_ids:['s2','s3']}]
 assert.equal(nearestSectionRoute(sections[2],sections,rules).rule.route_mode,'rfq')
 assert.equal(nearestSectionRoute(sections[2],sections,rules).inherited,true)
 assert.equal(nearestSectionRoute(sections[0],sections,rules).inherited,false)
 assert.equal(nearestSectionRoute(sections[2],sections,[rules[0]]).rule.route_mode,'direct')
 assert.equal(nearestSectionRoute(sections[2],sections,[]),null)
})
test('cyclic parent IDs do not hang inheritance checks',()=>{
 const sections=[{id:'one',parent_id:'two'},{id:'two',parent_id:'one'}]
 assert.equal(nearestSectionRoute(sections[0],sections,[]),null)
})

test('BOARD ITEMS parent includes 67 products nested one or two levels down',()=>{
 const sections=[
  {id:'board',name:'BOARD ITEMS',parent_id:null,active:true},
  {id:'cladding',name:'CLADDING BOARDS',parent_id:'board',active:true},
  {id:'film',name:'FILM-FACED BOARDS',parent_id:'board',active:true},
  {id:'melamine',name:'MELAMINE BOARDS',parent_id:'board',active:true},
  {id:'colours',name:'COLOURS',parent_id:'melamine',active:true}
 ]
 const rows=[
  ...Array.from({length:39},(_,i)=>({id:'a'+i,section_id:i<7?'cladding':i<14?'film':'melamine'})),
  ...Array.from({length:28},(_,i)=>({id:'b'+i,section_id:'colours'}))
 ]
 assert.deepEqual(sectionRouteCoverage('board',sections,rows),{
  directItems:0,totalItems:67,coveredItems:67,overriddenItems:0,descendantSections:4
 })
 assert.equal(sectionRouteCoverage('cladding',sections,rows).totalItems,7)
 assert.equal(sectionRouteCoverage('melamine',sections,rows).totalItems,53)
})
test('parent supplier rules cover inherited children but exclude independently routed subgroups',()=>{
 const sections=[
  {id:'board',parent_id:null,active:true},
  {id:'film',parent_id:'board',active:true},
  {id:'film2',parent_id:'film',active:true},
  {id:'cladding',parent_id:'board',active:true}
 ]
 const rows=[
  {id:'i1',section_id:'board'},
  {id:'i2',section_id:'film'},
  {id:'i3',section_id:'film2'},
  {id:'i4',section_id:'cladding'}
 ]
 assert.deepEqual(sectionRouteCoverage('board',sections,rows,[{section_id:'board'},{section_id:'film'}]),{
  directItems:1,totalItems:4,coveredItems:2,overriddenItems:2,descendantSections:3
 })
 assert.deepEqual(sectionRouteCoverage('film',sections,rows,[{section_id:'board'},{section_id:'film'}]),{
  directItems:1,totalItems:2,coveredItems:2,overriddenItems:0,descendantSections:1
 })
})
test('counting is scoped to active sections and rows, and cyclic section inputs cannot hang',()=>{
 const sections=[
  {id:'root',parent_id:null,active:true},
  {id:'valid',parent_id:'root',active:true},
  {id:'inactive',parent_id:'root',active:false},
  {id:'cycleA',parent_id:'cycleB',active:true},
  {id:'cycleB',parent_id:'cycleA',active:true}
 ]
 const rows=[
  {id:'one',section_id:'valid'},
  {id:'one',section_id:'valid'},
  {id:'inactive-one',section_id:'inactive'},
  {id:'inactive-row',section_id:'valid',active:false},
  {id:'cyclic',section_id:'cycleA'}
 ]
 assert.deepEqual(sectionRouteCoverage('root',sections,rows),{
  directItems:0,totalItems:1,coveredItems:1,overriddenItems:0,descendantSections:1
 })
 assert.equal(sectionRouteCoverage('cycleA',sections,rows).totalItems,1)
 assert.equal(sectionRouteCoverage('missing',sections,rows).totalItems,0)
})

test('automation opens the assigned single root category without combining separate routes',()=>{
 const sections=[{id:'root',active:true,parent_id:null},{id:'old',active:false,parent_id:'root'}]
 assert.equal(companyAutomationScope({},sections,[{section_id:'root'}]),'root')
 assert.equal(companyAutomationScope({},sections,[],[{section_id:'root'}]),'root')
 assert.equal(companyAutomationScope({},sections,[]),'company')
 assert.equal(companyAutomationScope({default_supplier_id:'s'},sections,[{section_id:'root'}]),'company')
 assert.equal(companyAutomationScope({},sections,[{section_id:null},{section_id:'root'}]),'company')
 assert.equal(companyAutomationScope({},[...sections,{id:'second',active:true,parent_id:null}],[{section_id:'root'}]),'company')
})
