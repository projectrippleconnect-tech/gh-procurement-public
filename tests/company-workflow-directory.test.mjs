import test from 'node:test'
import assert from 'node:assert/strict'
import {companyWorkflowMode,workflowRows,workflowValidation} from '../lib/company-workflow-directory.mjs'

const companies=[
 {id:'cmp-a',name:'PANEL SHEETS',default_supplier_id:'supplier1'},
 {id:'cmp-b',name:'ALCATHINE',default_supplier_id:'supplier4'}
];
const sections=[
 {id:'root',company_id:'cmp-a',name:'CEILING FITTINGS',parent_id:null,active:true},
 {id:'sub',company_id:'cmp-a',name:'WHITE PLAIN',parent_id:'root',active:true},
 {id:'deep',company_id:'cmp-a',name:'MAIN TEE',parent_id:'sub',active:true}
];
const routes=[
 {id:'rcompany',company_id:'cmp-a',section_id:null,route_mode:'rfq',auto_send:true,assigned_supplier_ids:['supplier1','supplier2']},
 {id:'rsub',company_id:'cmp-a',section_id:'sub',route_mode:'direct',auto_send:true,assigned_supplier_ids:['supplier3']}
];
const links=[
 {route_id:'rcompany',supplier_id:'supplier1',sort_order:1},
 {route_id:'rcompany',supplier_id:'supplier2',sort_order:2},
 {route_id:'rsub',supplier_id:'supplier3',sort_order:1}
];
test('all companies and every nested subcategory are shown without duplication',()=>{
 const output=workflowRows(companies,sections,routes,links);
 assert.equal(output.length,5);
 assert.equal(output.filter(x=>x.company.id==='cmp-b').length,1);
 assert.equal(output.find(x=>x.key==='cmp-b:company').path,'Entire company');
 assert.equal(output.find(x=>x.key==='cmp-a:deep').path,'CEILING FITTINGS / WHITE PLAIN / MAIN TEE');
});
test('child sections inherit a parent, but an explicitly configured PO overrides and passes to descendants',()=>{
 const list=workflowRows(companies,sections,routes,links)
 assert.equal(list.find(x=>x.key==='cmp-a:company').mode,'rfq')
 assert.equal(list.find(x=>x.key==='cmp-a:root').mode,'rfq')
 assert.equal(list.find(x=>x.key==='cmp-a:root').inherited,true)
 assert.deepEqual(list.find(x=>x.key==='cmp-a:root').recipients,['supplier1','supplier2'])
 assert.equal(list.find(x=>x.key==='cmp-a:sub').mode,'direct')
 assert.deepEqual(list.find(x=>x.key==='cmp-a:deep').recipients,['supplier3'])
 assert.equal(list.find(x=>x.key==='cmp-a:deep').inherited,true)
});
test('group-specific company contacts override recipient suggestions but do not silently enable sending',()=>{
 const pool=[{company_id:'cmp-a',section_id:'root',supplier_id:'supplier3',sort_order:1}]
 const list=workflowRows(companies,sections,[],[],pool)
 assert.deepEqual(list.find(x=>x.key==='cmp-a:deep').assigned,['supplier3'])
 assert.equal(list.find(x=>x.key==='cmp-a:deep').mode,'manual')
});
test('auto PO requires exactly one valid designated contact and RFQ can use multiple',()=>{
 const suppliers=[
  {id:'supplier1',whatsapp:'+94777123456'},
  {id:'supplier2',phone:'+94777123457'},
  {id:'bad',phone:'0771234567'}
 ];
 assert.equal(workflowValidation('direct',['supplier1','supplier2'],suppliers).valid,false)
 assert.equal(workflowValidation('direct',['supplier1'],suppliers).valid,true)
 assert.equal(workflowValidation('rfq',['supplier1','supplier2'],suppliers).valid,true)
 assert.equal(workflowValidation('rfq',['supplier1','bad'],suppliers).valid,false)
 assert.equal(workflowValidation('rfq',[],suppliers).valid,false)
 assert.equal(workflowValidation('manual',[],suppliers).valid,true)
});
test('existing disabled routes are shown as manual rather than falsely reporting auto sends',()=>{
 assert.equal(companyWorkflowMode({route_mode:'direct',auto_send:false}),'manual')
 assert.equal(companyWorkflowMode(null),'manual')
});
