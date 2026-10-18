import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const page=readFileSync('components/company-section-route-manager.jsx','utf8')
const sql=readFileSync('supabase/migrations/20261018160000_company_manual_po_dispatch_scope.sql','utf8')
const send=page.slice(page.indexOf('async function sendConfiguredRoute'),page.indexOf('async function removeOverride'))
const tools=page.slice(page.indexOf('if(toolsOnly)return <section'),page.indexOf('return <details className="card pad section" aria-label="Group supplier routing">'))

test('explicit PO send prepares only new IDs, queues only those IDs and then dispatches the same IDs',()=>{
 const select=send.indexOf("const poIds=Array.isArray(result.data)")
 const queue=send.indexOf("supabase.rpc('proc_company_queue_selected_po_send'")
 const dispatch=send.indexOf("companyApi('orders',{companyId:company.id,poIds})")
 assert.ok(select>=0&&queue>select&&dispatch>queue)
 assert.match(send,/p_company_id:company.id,p_po_ids:poIds/)
 assert.match(send,/if\(!queued.data\?\.ok\|\|queued.data.selected!==poIds.length\)/)
 assert.match(send,/PO created but not sent/)
 assert.doesNotMatch(send,/companyApi\('orders',\{companyId:company.id\}\)/)
})
test('advanced direct PO auto-send mode avoids two overlapping creation buttons',()=>{
 assert.match(tools,/!\(own.route_mode==='direct'&&own.auto_send\)&&<button/)
 assert.match(tools,/Create approved PO \(no WhatsApp send\)/)
 assert.match(tools,/Create & send new PO/)
 assert.match(tools,/warning:'This creates a new approved RFQ\/PO/)
})
test('manual dispatch queue has an administrative permission gate and bounded nonempty unique PO IDs',()=>{
 assert.match(sql,/private\.proc_assert_access\(\)/)
 assert.match(sql,/private\.proc_is_role\(ARRAY\['admin'\]\)/)
 assert.match(sql,/private\.proc_has_permission\('procurement.orders.approve'\)/)
 assert.match(sql,/v_selected_count<1 OR v_selected_count>200/)
 assert.match(sql,/count\(DISTINCT id\)/)
 assert.match(sql,/p_company_id IS NULL/)
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.proc_company_queue_selected_po_send/)
})
test('queue accepts approved, unsent, quantity-only POs and cannot retry uncertain or accepted sends',()=>{
 assert.match(sql,/v_po.status<>'approved'/)
 assert.match(sql,/v_po.sent_at IS NOT NULL/)
 assert.match(sql,/NOT v_po.quantity_only/)
 assert.match(sql,/v_po.company_id IS DISTINCT FROM p_company_id/)
 assert.match(sql,/v_existing<>'pending'/)
 assert.match(sql,/ON CONFLICT \(po_id\) DO NOTHING/)
 assert.doesNotMatch(sql,/UPDATE public\.proc_company_dispatch_queue|UPDATE public\.proc_purchase_orders|DELETE FROM|TRUNCATE/)
 assert.doesNotMatch(sql,/sendImage|sendText|WAHA_BASE_URL|http:\/\//)
})
