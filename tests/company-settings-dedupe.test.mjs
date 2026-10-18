import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {supplierNumberConflicts,otherNamesForNumber} from '../lib/company-contact-conflicts.mjs'

test('Sri Lankan number formats are treated as the same number across supplier types',()=>{
 const records=[
  {id:'a',name:'Main',phone:'077 979 2078',supplier_kind:'company'},
  {id:'b',name:'Sample Supplier',whatsapp:'+94 77 979 2078',supplier_kind:'general'},
  {id:'c',name:'SAMPLE SUPPLIER',phone:'779792078',supplier_kind:'general'},
  {id:'d',name:'Different',phone:'011 234 5678'}
 ]
 const found=supplierNumberConflicts(records)
 assert.equal(found.length,1)
 assert.equal(found[0].phone,'+94779792078')
 assert.deepEqual([...new Set(found[0].entries.map(x=>x.name))],['Main','Sample Supplier','SAMPLE SUPPLIER'])
 assert.deepEqual(otherNamesForNumber('0779792078',records,'Main'),['Sample Supplier','SAMPLE SUPPLIER'])
})
test('repeated numbers with the same supplier name are not name conflicts',()=>{
 assert.deepEqual(supplierNumberConflicts([{id:'a',name:'Purchase',phone:'0771234567'},{id:'b',name:'purchase',phone:'+94771234567'}]),[])
 assert.deepEqual(otherNamesForNumber('not a phone',[],'Purchase'),[])
})
test('four company settings sections remain and the duplicate setup wizard is no longer rendered',()=>{
 const jsx=readFileSync('components/modules-company.jsx','utf8')
 const start=jsx.indexOf('{setupOpen&&<div className="company-setup-panel"')
 const end=jsx.indexOf('{!setupOpen&&<div className="card pad section company-count-workspace"')
 assert.ok(start>0&&end>start)
 const setup=jsx.slice(start,end)
 for(const component of ['CompanyContactDirectory','CompanyWorkflowDirectory','WhatsAppAuditGroups','CompanyRowLayoutControls'])assert.match(setup,new RegExp('<'+component+'\\b'))
 assert.doesNotMatch(setup,/<CompanyAutomationSimple\\b/)
 assert.match(setup,/RFQ &amp; PO Workflow Settings/)
 assert.match(setup,/Advanced group sending &amp; document templates/)
 const workflow=readFileSync('components/company-workflow-directory.jsx','utf8')
 assert.match(workflow,/embedded=false/)
 assert.match(workflow,/const Container=embedded\?'section':'details'/)
})
test('duplicate phone warnings are advisory; contact routing and history are never automatically edited',()=>{
 const directory=readFileSync('components/company-contact-directory.jsx','utf8')
 assert.match(directory,/supplierNumberConflicts/)
 assert.match(directory,/Duplicate number warning/)
 assert.match(directory,/otherNamesForNumber/)
 assert.doesNotMatch(directory,/from\('proc_company_section_routes'\)\.delete\(/)
})
