import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const manager=readFileSync('components/company-section-route-manager.jsx','utf8')
const mount=readFileSync('components/modules-company.jsx','utf8')
const sql=readFileSync('supabase/migrations/20261018143000_company_template_only_route_edit.sql','utf8')
const start=manager.indexOf('if(toolsOnly)return <section')
const finish=manager.indexOf('return <details className="card pad section" aria-label="Group supplier routing">',start)
const advanced=manager.slice(start,finish)

test('Company Lists mounts advanced document actions instead of second routing editor',()=>{
 assert.ok(start>0&&finish>start)
 assert.match(mount,/CompanySectionRouteManager[^\n]*\btoolsOnly\s*\/>/)
 assert.match(advanced,/Advanced company document tools/)
 assert.match(advanced,/Supplier assignment, recipient selection and RFQ\/PO automation are edited only/)
 assert.doesNotMatch(advanced,/p_assigned_ids|p_recipient_ids|proc_company_save_supplier_setup/)
 assert.doesNotMatch(advanced,/<input[^>]+type="radio"/)
 assert.doesNotMatch(advanced,/toggleGroupContact|toggleRecipient|Save group route|Save &amp; send PO now/)
})
test('advanced panel preserves all unique capabilities without duplicate setting updates',()=>{
 for(const term of ['Image &amp; caption','Save image &amp; caption only','Send RFQ image now',
  'Send PO image now','Prepare approved RFQ','Create approved PO','Resume eligible RFQ images',
  'Outgoing','WhatsApp caption','Blank unit-rate column']){
  if(term==='Outgoing')continue
  assert.ok(advanced.includes(term),'missing '+term)
 }
 assert.match(manager,/async function saveTemplateOnly/)
 assert.match(manager,/proc_company_update_route_template/)
 assert.match(manager,/async function sendConfiguredRoute/)
 assert.match(manager,/setPendingRfq\(result.data\)/)
 assert.match(advanced,/sendConfiguredRoute\(section,own\)/)
})
test('template RPC only updates one route document and uses access, size and optimistic locking guards',()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.proc_company_update_route_template/)
 assert.match(sql,/private\.proc_assert_access\(\)/)
 assert.match(sql,/company_lists\.manage/)
 assert.match(sql,/FOR UPDATE OF r/)
 assert.match(sql,/p_expected_updated_at/)
 assert.match(sql,/octet_length\(p_template::text\)>6000/)
 assert.match(sql,/SET document_template=p_template,updated_by=auth\.uid\(\),updated_at=clock_timestamp\(\)/)
 assert.doesNotMatch(sql,/DELETE FROM|TRUNCATE|DROP TABLE|UPDATE public\.proc_suppliers/)
 assert.doesNotMatch(sql,/SET route_mode|SET auto_send|SET assigned_supplier_ids|UPDATE public\.proc_company_section_route_suppliers/)
 assert.match(sql,/REVOKE ALL ON FUNCTION .*proc_company_update_route_template/)
})
test('sending existing route rechecks live route and recipient membership before any dispatch',()=>{
 const send=manager.slice(manager.indexOf('async function sendConfiguredRoute'),manager.indexOf('async function removeOverride'))
 assert.ok(send.indexOf("from('proc_company_section_routes')")>=0)
 assert.ok(send.indexOf("from('proc_company_section_route_suppliers')")>=0)
 assert.ok(send.indexOf('Recipient selections changed')<send.indexOf('const gateway=await gatewayRequest'))
 assert.match(send,/recipientIds\.length!==1/)
 assert.match(send,/sendRfq\(result.data\)/)
 assert.match(send,/companyApi\('orders',\{companyId:company.id,poIds\}\)/)
 assert.doesNotMatch(send,/await save\(/)
})

test('advanced one-group PO preparation sends only newly created purchase-order IDs',()=>{
 const start=manager.indexOf('async function prepare(s,rule)')
 const end=manager.indexOf('if(!company?.id||!admin)return null',start)
 const body=manager.slice(start,end)
 assert.ok(start>0&&end>start)
 assert.match(body,/const createdIds=createdOrders\.map\(po=>po\?\.id\)\.filter\(Boolean\)/)
 assert.match(body,/if\(!createdIds\.length\)throw/)
 assert.match(body,/companyApi\('orders',\{companyId:company.id,poIds:createdIds\}\)/)
 assert.doesNotMatch(body,/companyApi\('orders',\{companyId:company.id\}\)/)
})
test('advanced actions retain explicit override removal, without resetting any history automatically',()=>{
 assert.match(advanced,/Use inherited \/ company default/)
 assert.match(advanced,/Existing RFQs and POs and their history are retained/)
 assert.match(advanced,/onConfirm:\(\)=>run\(\(\)=>removeOverride\(section\)\)/)
 const fn=manager.slice(manager.indexOf('async function removeOverride'),manager.indexOf('async function contactSaved'))
 assert.match(fn,/proc_company_clear_section_route/)
 assert.match(fn,/await onChanged\(\)/)
 assert.doesNotMatch(fn,/delete\(\)|truncate|DROP TABLE/i)
})
