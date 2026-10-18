import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const directory=readFileSync('components/company-contact-directory.jsx','utf8')
const workflow=readFileSync('components/company-workflow-directory.jsx','utf8')
const company=readFileSync('components/modules-company.jsx','utf8')
const advanced=readFileSync('components/company-section-route-manager.jsx','utf8')

test('directory save, edit and delete notify other supplier panels only after verified readback',()=>{
 assert.match(directory,/onDirectoryChanged=\(\)=>\{\}/)
 const save=directory.slice(directory.indexOf('async function saveContact'),directory.indexOf('function beginEdit'))
 const edit=directory.slice(directory.indexOf('async function saveEdit'),directory.indexOf('async function removeContact'))
 const deletion=directory.slice(directory.indexOf('async function removeContact'),directory.indexOf('if\(!canManage\)return null'))
 for(const [part,companyId] of [[save,'selected.id'],[edit,'original.company_id'],[deletion,'c.company_id']]){
  assert.ok(part.indexOf('await load(true)')>=0,'missing readback')
  assert.ok(part.indexOf('onDirectoryChanged('+companyId+')')>part.indexOf('await load(true)'),'callback must follow readback')
 }
})
test('All Companies edit and delete retain the affected company for routing review',()=>{
 assert.match(directory,/setRoutingReviewCompanyId\(original.company_id\)/)
 assert.match(directory,/setRoutingReviewCompanyId\(c.company_id\)/)
 assert.match(directory,/onReviewRouting\(routingReviewCompanyId\|\|null\)/)
})
test('parent opens workflow, refreshes data and targets relevant company without a global document query',()=>{
 assert.match(company,/const workflowPanelRef=useRef\(null\)/)
 assert.match(company,/setDirectoryRevision\(v=>v\+1\)/)
 assert.match(company,/setWorkflowReviewRequest\(v=>\(\{companyId:id,sequence:v.sequence\+1\}\)\)/)
 assert.match(company,/ref=\{workflowPanelRef\}/)
 assert.match(company,/directoryRevision=\{directoryRevision\} reviewRequest=\{workflowReviewRequest\}/)
 assert.doesNotMatch(company,/document\.querySelector\('\.company-workflow-hub'\)/)
})
test('workflow reloads on verified directory writes and displays targeted supplier choices',()=>{
 assert.match(workflow,/directoryRevision=0,reviewRequest=null/)
 assert.match(workflow,/\[active,load,refresh,directoryRevision\]/)
 assert.match(workflow,/setQuery\(company.name\)/)
 assert.match(workflow,/setExpanded\(prev=>\(\{\.\.\.prev,\[company.id\]:true\}\)\)/)
 assert.match(workflow,/setContactsOpen\(company.id\+':company'\)/)
 assert.match(workflow,/if\(loadToken===loadVersion.current\)setData\(next\)/)
})
test('advanced saved routes trigger main workflow reload; no documents are sent by directory review',()=>{
 assert.match(advanced,/directoryRevision=0/)
 assert.match(advanced,/\[company\?\.id,company\?\.updated_at,directoryRevision\]/)
 assert.match(company,/onChanged=\{syncCompanySupplierPanels\}/)
 assert.match(company,/onRoutesChanged=\{syncCompanySupplierPanels\}/)
 assert.match(company,/const syncCompanySupplierPanels=useCallback/)
 assert.doesNotMatch(directory,/companyApi\('orders'/)
})
