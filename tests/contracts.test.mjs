import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'

const root=process.cwd()
const read=p=>readFileSync(join(root,p),'utf8')

test('stock entry is atomic, user-scoped, review-first and not capped at 500 items',()=>{
  const stock=read('components/modules-stock.jsx')
  assert.match(stock,/gh-stock-count-draft:'\+profile\.id|gh-stock-count-draft:\$\{profile\.id\}|draftKey='gh-stock-count-draft:'\+profile\.id/)
  assert.match(stock,/proc_submit_stock_and_continue_v3/)
  assert.match(stock,/proc_begin_stock_count_session_v1/)
  assert.match(stock,/startPromise=useRef\(null\)/)
  assert.doesNotMatch(stock,/proc_submit_stock_and_continue_v2/)
  assert.doesNotMatch(stock,/range\(0,dueOnly\?Math\.max\(dailyTarget-1,0\):499\)/)
  assert.match(stock,/Shortages will go to Procurement Review/)
  assert.match(stock,/Discard Draft/)
})

test('stock submission history preserves prior counts and can be expanded',()=>{
  const stock=read('components/modules-stock.jsx')
  const migration=read('supabase/migrations/049_procurement_four_step_flow.sql')
  const i18n=read('lib/i18n.js')
  assert.match(stock,/Stock Submission History/)
  assert.match(stock,/proc_stock_submission_history_v1/)
  assert.match(stock,/proc_stock_submission_detail_v1/)
  assert.match(i18n,/older submissions stay unchanged/)
  assert.match(migration,/create or replace function public\.proc_stock_submission_history_v1/)
  assert.match(migration,/create or replace function public\.proc_stock_submission_detail_v1/)
  assert.match(migration,/where c\.status='submitted'/)
})

test('routine shortages stop at buyer review instead of auto-awarding',()=>{
  const buying=read('components/modules-buying.jsx')
  const migration=read('supabase/migrations/049_procurement_four_step_flow.sql')
  assert.match(migration,/procurement\.straight_through/)
  assert.match(migration,/enabled=false/)
  assert.match(migration,/manual_review_required/)
  assert.match(migration,/review_required/)
  assert.match(migration,/source_type='stock_count'/)
  assert.match(migration,/caller,'stock_count'/)
  assert.match(migration,/source_type='manual'/)
  assert.match(migration,/source_type='normal' and source_count_line_id is null/)
  assert.match(migration,/then 'quoting'/)
  assert.match(migration,/set selected_for_po=\(new_target>existing_req\.ordered_qty\)/)
  assert.match(migration,/as has_active_rfq/)
  assert.match(buying,/eq\('has_active_rfq',false\)/)
  assert.doesNotMatch(buying,/proc_try_auto_award_v2/)
  assert.match(buying,/Approve & Continue/)
  assert.match(buying,/Step 4 · Review & Choose Suppliers/)
})

test('guided procurement path continues numbering after stock entry',()=>{
  const ui=read('components/ui.jsx')
  const buying=read('components/modules-buying.jsx')
  const docs=read('components/modules-documents.jsx')
  assert.match(ui,/1 ·/)
  assert.match(ui,/2 ·/)
  assert.match(ui,/3 ·/)
  assert.match(ui,/\[4,t\('journey\.review'/)
  assert.match(ui,/\[5,t\('journey\.rfq'/)
  assert.match(ui,/\[6,t\('journey\.quotes'/)
  assert.match(ui,/\[7,t\('journey\.order'/)
  assert.match(buying,/ProcurementPath active=\{4\}/)
  assert.match(buying,/ProcurementPath active=\{journeyStage\}/)
  assert.match(buying,/awardOpen\?7/)
  assert.match(docs,/ProcurementPath active=\{7\}/)
})

test('RFQs are prepared until actual transmission is confirmed',()=>{
  const buying=read('components/modules-buying.jsx')
  const migration=read('supabase/migrations/048_procurement_complete_hardening.sql')
  assert.match(buying,/proc_create_rfq_v4/)
  assert.match(buying,/proc_mark_rfq_supplier_sent_v1/)
  assert.match(buying,/Confirm Sent/)
  assert.match(migration,/values\(rfq_id,rfq_no,'prepared'/)
  assert.match(migration,/status='sent',sent_at=now\(\),sent_by=caller/)
})

test('supplier RFQs can be exported as PDFs before sending',()=>{
  const buying=read('components/modules-buying.jsx')
  const pdf=read('lib/pdf.js')
  assert.match(buying,/exportSupplierPriceRequestPdf/)
  assert.match(buying,/RFQ PDF/)
  assert.match(pdf,/export function exportSupplierPriceRequestPdf/)
  assert.match(pdf,/REQUEST FOR QUOTATION/)
  assert.match(pdf,/Delivery \/ Lead Time/)
})

test('quote OCR cannot reuse one supplier row and no size-only match is accepted',()=>{
  const buying=read('components/modules-buying.jsx')
  assert.match(buying,/usedRows=new Set\(\)/)
  assert.match(buying,/usedRows\.has\(index\)/)
  assert.match(buying,/acceptable:codeExact\|\|descriptionStrong/)
  assert.doesNotMatch(buying,/bestScore>=0\.45/)
})

test('award review is delivery-aware for urgent items and still supports audited overrides',()=>{
  const buying=read('components/modules-buying.jsx')
  const awardMigration=read('supabase/migrations/043_procurement_quote_award_hardening.sql')
  const hardening=read('supabase/migrations/048_procurement_complete_hardening.sql')
  assert.match(buying,/function itemNeedsSpeed/)
  assert.match(buying,/priority==='urgent'\|\|priority==='high'/)
  assert.match(buying,/Faster delivery preferred/)
  assert.match(buying,/recommendedQuoteLine/)
  assert.match(buying,/automaticAwardReason/)
  assert.match(buying,/System recommendation: faster delivery for urgent\/high-priority requirement/)
  assert.match(buying,/System allocation: lower-cost suppliers could not fully cover/)
  assert.match(buying,/override_reason/)
  assert.match(buying,/proc_finalize_award_plan_v2/)
  assert.match(awardMigration,/Choosing a non-recommended supplier requires an override reason/)
  assert.match(hardening,/count\(distinct q\.supplier_id\)/)
  assert.match(hardening,/least\(preferred,greatest\(eligible,1\)\)/)
})

test('landed-cost comparison cannot be diluted by declared availability',()=>{
  const migration=read('supabase/migrations/048_procurement_complete_hardening.sql')
  assert.match(migration,/least\(coalesce\(ql\.available_qty,qi\.requested_qty\),qi\.requested_qty\)/)
  assert.doesNotMatch(migration,/sum\(COALESCE\(ql\.available_qty, qi\.requested_qty\)\)/)
})

test('invoice matching is PO + GRN + invoice and receiving requires rejection reasons',()=>{
  const docs=read('components/modules-documents.jsx')
  const migration=read('supabase/migrations/048_procurement_complete_hardening.sql')
  assert.match(docs,/proc_create_invoice_v4/)
  assert.match(docs,/Already Invoiced/)
  assert.match(docs,/Invoiceable/)
  assert.match(migration,/available_to_invoice:=greatest\(accepted_to_date-previously_invoiced,0\)/)
  assert.match(migration,/proc_v_invoiceable_po_lines/)
  assert.match(docs,/invoiceLines=lines\.filter/)
  assert.match(migration,/A rejection reason is required/)
})

test('health check reports commit and database readiness',()=>{
  const route=read('app/api/health/route.ts')
  assert.match(route,/VERCEL_GIT_COMMIT_SHA/)
  assert.match(route,/proc_healthcheck_v1/)
  assert.match(route,/schema_ready/)
})

test('automation exceptions remain durable for non-routine failures',()=>{
  const urgent=read('components/modules-urgent.jsx')
  const migration=read('supabase/migrations/048_procurement_complete_hardening.sql')
  assert.match(migration,/create table if not exists public\.proc_automation_jobs/)
  assert.match(urgent,/Automation Exceptions/)
  assert.match(urgent,/proc_retry_automation_job_v1/)
  assert.match(urgent,/rfq_reminder/)
  assert.match(urgent,/po_delivery_overdue/)
  assert.match(migration,/proc_automation_sweep_v1/)
})


test('password changes enforce the hardened free-plan fallback policy',()=>{
  const auth=read('components/auth-screen.jsx')
  assert.match(auth,/function passwordIssue\(value\)/)
  assert.match(auth,/value\.length<12/)
  assert.match(auth,/\!\/\[a-z\]\//)
  assert.match(auth,/\!\/\[A-Z\]\//)
  assert.match(auth,/\!\/\[0-9\]\//)
  assert.match(auth,/\!\/\[\^A-Za-z0-9\]\//)
  assert.match(auth,/Enter your current password\./)
  assert.match(auth,/12\+ with upper\/lowercase, number & symbol/)
})


test('production runtime is pinned to Node 24',()=>{
  const pkg=JSON.parse(read('package.json'))
  assert.equal(pkg.engines?.node,'24.x')
})


test('dependency install scripts are explicitly denied and unreviewed scripts fail closed',()=>{
  const pkg=JSON.parse(read('package.json'))
  const npmrc=read('.npmrc')
  assert.equal(pkg.allowScripts?.['tesseract.js'],false)
  assert.equal(pkg.allowScripts?.['core-js'],false)
  assert.match(npmrc,/^strict-allow-scripts=true\s*$/)
})


test('WhatsApp links normalize Sri Lankan local numbers before opening',()=>{
  const helpers=read('lib/helpers.ts')
  const buying=read('components/modules-buying.jsx')
  const docs=read('components/modules-documents.jsx')

  assert.match(helpers,/export const normalizeWhatsAppNumber/)
  assert.match(helpers,/digits\.startsWith\('0'\).*countryCode \+ digits\.slice\(1\)/s)
  assert.match(helpers,/digits\.length === 9 && digits\.startsWith\('7'\)/)
  assert.match(helpers,/export const whatsappUrl/)
  assert.match(helpers,/https:\/\/wa\.me\/\$\{number\}/)

  assert.match(buying,/whatsappUrl\(s\.whatsapp\)/)
  assert.match(buying,/whatsappUrl\(s\.whatsapp\|\|s\.phone,msg\)/)
  assert.match(docs,/whatsappUrl\(active\?\.supplier\?\.whatsapp,/)

  assert.doesNotMatch(buying,/https:\/\/wa\.me\/.*replace\(\/\\D\/g/)
  assert.doesNotMatch(docs,/https:\/\/wa\.me\/.*replace\(\/\\D\/g/)
})


test('RFQ sharing offers reply-ready text, PNG sharing and aligned supplier quote outputs',()=>{
  const buying=read('components/modules-buying.jsx')
  const share=read('lib/rfq-share.js')
  const pdf=read('lib/pdf.js')

  assert.match(buying,/Share Text \+ PNG/)
  assert.match(buying,/WhatsApp Text/)
  assert.match(buying,/Download PNG/)
  assert.match(buying,/Copy Reply Text/)
  assert.match(buying,/shareSupplierPriceRequestPng/)
  assert.match(buying,/downloadSupplierPriceRequestPng/)
  assert.match(buying,/buildSupplierQuoteReplyText/)

  assert.match(share,/export function buildSupplierQuoteReplyText/)
  assert.match(share,/Rate: Rs\. ______/)
  assert.match(share,/Availability: ______/)
  assert.match(share,/Delivery \/ Lead Time: ______/)
  assert.match(share,/Payment Terms: ______/)
  assert.match(share,/export async function createSupplierPriceRequestPng/)
  assert.match(share,/label:'QTY'/)
  assert.match(share,/label:'UNIT RATE'/)
  assert.match(share,/navigator\.share/)
  assert.match(share,/downloadSupplierPriceRequestPng/)

  assert.match(pdf,/label:'Qty'/)
  assert.match(pdf,/label:'Item \/ Size'/)
  assert.match(pdf,/label:'Unit Rate'/)
})
