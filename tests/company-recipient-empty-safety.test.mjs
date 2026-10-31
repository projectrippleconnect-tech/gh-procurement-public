import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {workflowRows} from '../lib/company-workflow-directory.mjs'

const companies=[{id:'alpha',name:'ALCATHINE',default_supplier_id:'a'}]
test('an explicitly configured route without recipients never invents them from assigned supplier IDs',()=>{
 const routes=[{id:'r1',company_id:'alpha',section_id:null,route_mode:'direct',auto_send:true,assigned_supplier_ids:['a','b','c']}]
 const rows=workflowRows(companies,[],routes,[])
 assert.deepEqual(rows[0].assigned,['a','b','c'])
 assert.deepEqual(rows[0].recipients,[])
 assert.equal(rows[0].mode,'direct')
})
test('only actual recipient links are displayed and recorded, even if assigned contact list is larger',()=>{
 const routes=[{id:'r1',company_id:'alpha',section_id:null,route_mode:'direct',auto_send:true,assigned_supplier_ids:['a','b','c']}]
 const links=[{route_id:'r1',supplier_id:'b',sort_order:1}]
 const rows=workflowRows(companies,[],routes,links)
 assert.deepEqual(rows[0].assigned,['a','b','c'])
 assert.deepEqual(rows[0].recipients,['b'])
})
test('new unsaved company with no route may suggest fallback contact without implying auto sending',()=>{
 const rows=workflowRows(companies,[],[],[])
 assert.deepEqual(rows[0].assigned,['a'])
 assert.deepEqual(rows[0].recipients,['a'])
 assert.equal(rows[0].mode,'manual')
})
test('workflow flags missing recipients before document creation and keeps Save a settings-only action',()=>{
 const src=readFileSync('components/company-workflow-directory.jsx','utf8')
 assert.match(src,/No sending recipient selected/)
 assert.match(src,/role="status"/)
 assert.match(src,/p_recipient_ids:choice.mode==='manual'\?choice.assigned:choice.ids/)
 assert.doesNotMatch(src,/companyApi\('orders'/)
})
