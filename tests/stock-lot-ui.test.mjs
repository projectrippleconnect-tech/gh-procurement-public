import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync(new URL('../components/modules-stock.jsx',import.meta.url),'utf8')

test('stock header opens review rather than calling the submit RPC',()=>{
 assert.match(ui,/Review Lot · /)
 assert.match(ui,/onClick=\{\(\)=>setLotReviewOpen\(true\)\}/)
 assert.match(ui,/Final confirm · /)
 assert.match(ui,/onClick=\{submit\}/)
 const submitCalls=[...ui.matchAll(/supabase\.rpc\('proc_submit_stock_and_continue_v3'/g)]
 assert.equal(submitCalls.length,1,'exactly one final stock RPC call')
})
test('final submission requires verified history and explicit previous-item recount',()=>{
 assert.match(ui,/if\(!markersReady\)throw new Error/)
 assert.match(ui,/if\(lot\.blocked\.length\)throw new Error/)
 assert.match(ui,/if\(lot\.overLimit\)throw new Error/)
 assert.match(ui,/submissionLock\.current=true/)
 assert.match(ui,/onClick=\{\(\)=>allowRecount\(i\.item_id\)\}/)
})
test('save and pause has no stock submission side effect',()=>{
 assert.match(ui,/Save &amp; pause/)
 assert.match(ui,/No items counted yet/)
 assert.match(ui,/Draft edits save automatically/)
})
