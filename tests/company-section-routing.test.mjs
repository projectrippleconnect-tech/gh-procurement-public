import test from 'node:test'
import assert from 'node:assert/strict'
import {defaultSectionRoute,nearestSectionRoute,validateSectionRoute} from '../lib/company-section-routing.mjs'

test('one designated supplier defaults to direct order and auto-send; multiple to RFQ',()=>{
 assert.deepEqual(defaultSectionRoute(1),{mode:'direct',autoSend:true})
 assert.deepEqual(defaultSectionRoute(2),{mode:'rfq',autoSend:false})
 assert.deepEqual(defaultSectionRoute(3),{mode:'rfq',autoSend:false})
})
test('RFQ supports one or more suppliers, and never auto-sends a PO',()=>{
 assert.deepEqual(validateSectionRoute({mode:'rfq',supplierIds:['s1','s2','s3'],autoSend:true}),{valid:true,mode:'rfq',supplierIds:['s1','s2','s3'],autoSend:false})
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
