import test from 'node:test'
import assert from 'node:assert/strict'
import {REQUESTED_COMPANY_MODES,requestedModeFor,companyScopeTree,companyBranchRows,branchOverrideRows,parentApplyPreview,branchItemCount} from '../lib/company-workflow-tree.mjs'

const companies=[{id:'c1',name:'PANEL SHEETS'},{id:'c2',name:'ALCATHINE'}]
const section=[
 {id:'p',company_id:'c1',parent_id:null,name:'CEILING FITTINGS',active:true},
 {id:'a',company_id:'c1',parent_id:'p',name:'WHITE PLAIN',active:true},
 {id:'b',company_id:'c1',parent_id:'p',name:'BLACK LINE',active:true},
 {id:'deep',company_id:'c1',parent_id:'a',name:'MAIN TEE',active:true}
]
const row=(company,id,name,parent,own=false)=>({
 key:company.id+':'+(id||'company'),company,section:id?{id,name,parent_id:parent}:null,section_id:id,path:name,
 own:own?{id:'route-'+id}:null
})
const rows=[
 row(companies[0],null,'Entire company',null,true),
 row(companies[0],'p','CEILING FITTINGS',null,false),
 row(companies[0],'a','CEILING FITTINGS / WHITE PLAIN','p',true),
 row(companies[0],'b','CEILING FITTINGS / BLACK LINE','p',false),
 row(companies[0],'deep','CEILING FITTINGS / WHITE PLAIN / MAIN TEE','a',true),
 row(companies[1],null,'Entire company',null)
]
test('the 19 requested modes are exact and missing company names are never assumed',()=>{
 assert.equal(Object.keys(REQUESTED_COMPANY_MODES).length,19)
 assert.equal(Object.values(REQUESTED_COMPANY_MODES).filter(x=>x==='rfq').length,9)
 assert.equal(Object.values(REQUESTED_COMPANY_MODES).filter(x=>x==='direct').length,10)
 assert.equal(requestedModeFor('  panel sheets '),'rfq')
 assert.equal(requestedModeFor(' ALKATHINE '),'direct')
 assert.equal(requestedModeFor('KEVILTON'),'direct')
 assert.equal(requestedModeFor('OTHER COMPANY'),null)
});
test('tree nests subcategories under correct parent with no other-company bleed',()=>{
 const tree=companyScopeTree(rows,'c1')
 assert.equal(tree.company.key,'c1:company')
 assert.deepEqual(tree.sections.map(n=>n.row.section_id),['p'])
 assert.deepEqual(tree.sections[0].children.map(n=>n.row.section_id),['b','a'])
 assert.equal(tree.sections[0].children.find(x=>x.row.section_id==='a').children[0].row.section_id,'deep')
 assert.equal(companyScopeTree(rows,'c2').sections.length,0)
});
test('parent update controls all descendants, including grandchildren; own overrides can be cleared explicitly',()=>{
 assert.equal(companyBranchRows(rows,rows[0]).length,5)
 assert.equal(companyBranchRows(rows,rows[1]).length,4)
 assert.deepEqual(branchOverrideRows(rows,rows[1]).map(r=>r.section_id),['a','deep'])
 assert.equal(parentApplyPreview(rows,rows[1]).overridesToClear.length,2)
 assert.equal(parentApplyPreview(rows,rows[1],{includeChildren:false}).overridesToClear.length,0)
 assert.deepEqual(branchOverrideRows(rows,rows[5]),[])
});
test('item counts include whole branch, never sibling or other company',()=>{
 const items=[
 {id:'i1',company_id:'c1',section_id:'p'},
 {id:'i2',company_id:'c1',section_id:'a'},
 {id:'i3',company_id:'c1',section_id:'deep'},
 {id:'i4',company_id:'c1',section_id:'b'},
 {id:'i5',company_id:'c2',section_id:null}
 ]
 assert.equal(branchItemCount(items,rows[0],section),4)
 assert.equal(branchItemCount(items,rows[1],section),4)
 assert.equal(branchItemCount(items,rows[2],section),2)
 assert.equal(branchItemCount(items,rows[5],section),1)
});
