import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {duplicateContactNumbers,matchContactPhone} from '../lib/contact-duplicates.mjs'

test('four company setup panels remain without the duplicated supplier wizard',()=>{
 const source=readFileSync('components/modules-company.jsx','utf8')
 const start=source.indexOf('{setupOpen&&<div className="company-setup-panel"')
 const end=source.indexOf('{!setupOpen&&<div className="card pad section company-count-workspace"')
 assert.ok(start>=0&&end>start)
 const block=source.slice(start,end)
 for(const panel of ['CompanyContactDirectory','CompanyWorkflowDirectory','WhatsAppAuditGroups','CompanyRowLayoutControls']){
  assert.match(block,new RegExp('<'+panel+'\\b'))
 }
 assert.doesNotMatch(block,/<CompanyAutomationSimple\b/)
 assert.match(block,/RFQ &amp; PO Workflow Settings/)
 assert.match(block,/CompanySectionRouteManager/)
 assert.match(block,/Advanced group sending &amp; document templates/)
 assert.match(block,/embedded\/>/)
})
test('workflow checklist can be embedded without rendering a second title',()=>{
 const source=readFileSync('components/company-workflow-directory.jsx','utf8')
 assert.match(source,/embedded=false/)
 assert.match(source,/const Container=embedded\?'section':'details'/)
 assert.match(source,/!embedded&&<summary>/)
 assert.match(source,/proc_company_save_supplier_setup/)
})
test('company contact warnings still use a single shared detector and require review',()=>{
 const source=readFileSync('components/company-contact-directory.jsx','utf8')
 assert.match(source,/contact-duplicates\.mjs/)
 assert.match(source,/duplicateContactNumbers/)
 assert.match(source,/reviewedAddConflict/)
 assert.match(source,/reviewedEditConflict/)
 assert.doesNotMatch(source,/company-contact-conflicts\.mjs/)
 const matches=duplicateContactNumbers([
  {id:'1',company_id:'one',name:'Main',phone:'077 979 2078'},
  {id:'2',company_id:'two',name:'Sample Supplier',phone:'+94 77 979 2078'}
 ])
 assert.equal(matches.length,1)
 assert.equal(matches[0].differentNames,true)
 assert.equal(matchContactPhone([{name:'Main',phone:'0779792078'}],'+94779792078').length,1)
})
test('display and legacy fallback are labelled separately from primary routing',()=>{
 const controls=readFileSync('components/company-controls.jsx','utf8')
 const layout=readFileSync('components/company-row-layout.jsx','utf8')
 assert.match(controls,/Company details, legacy fallback &amp; attachments/)
 assert.match(controls,/RFQ &amp; PO Workflow Settings above/)
 assert.match(layout,/Company Display Settings/)
})
