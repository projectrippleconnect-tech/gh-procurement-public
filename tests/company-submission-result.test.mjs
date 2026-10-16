import test from 'node:test'
import assert from 'node:assert/strict'
import {companySubmissionMessage} from '../lib/company-submission-result.mjs'
test('zero new requirement rows does not imply zero physical shortages',()=>{
 const s=companySubmissionMessage({count_no:'034',requirements_created:0,stock_outcomes:[{shortage_qty:20,uncovered_qty:0}]})
 assert.match(s,/No new PO created/);assert.match(s,/cover 1 shortage/);assert.doesNotMatch(s,/0 new shortage|No purchasing needed/)
})
test('changed need against a pending order explicitly needs review',()=>{
 const s=companySubmissionMessage({count_no:'035',stock_outcomes:[{shortage_qty:10,uncovered_qty:1,needs_review:true}]})
 assert.match(s,/need review/);assert.match(s,/not automatically increased/)
})
test('a newly created PO is distinct from WhatsApp delivery',()=>{
 const s=companySubmissionMessage({count_no:'033',purchase_orders:[{po_no:'002'}]})
 assert.match(s,/PO 002 created/);assert.doesNotMatch(s,/sent|delivered/)
})
test('sufficient stock is distinct from purchasing already covered',()=>{
 assert.match(companySubmissionMessage({stock_outcomes:[{shortage_qty:0,uncovered_qty:0}]}),/No purchasing needed/)
 assert.doesNotMatch(companySubmissionMessage({requirements_created:0}),/No purchasing needed/)
})
