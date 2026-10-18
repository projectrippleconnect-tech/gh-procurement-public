import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync(new URL('../components/modules-stock.jsx',import.meta.url),'utf8')

test('stock header opens review rather than calling the submit RPC',()=>{
 assert.match(ui,/Review Lot · /)
 assert.match(ui,/onClick=\{\(\)=>setLotReviewOpen\(true\)\}/)
 assert.match(ui,/Finalize · /)
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
 assert.match(ui,/Save draft/)
 assert.match(ui,/No items counted yet/)
 assert.match(ui,/Draft edits save automatically/)
})

test('mobile review controls precede stock rows and remain in one non-overlapping row',()=>{
 const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
 const latest=css.slice(css.lastIndexOf('/* Stock lot review: keep actions in a single thin row'))
 assert.ok(latest.length>300,'latest compact layout CSS is present')
 assert.ok(ui.indexOf('className="stock-lot-actions"')<ui.indexOf('className="stock-lot-rows"'),'actions are before list in tab order')
 assert.match(latest,/\.stock-lot-modal>\.stock-lot-actions\s*\{[^}]*position:static;/s)
 assert.match(latest,/\.stock-lot-modal>\.stock-lot-rows\s*\{[^}]*overflow-y:auto;/s)
 assert.match(latest,/grid-template-columns:minmax\(0,1fr\) minmax\(0,\.85fr\) minmax\(0,1\.08fr\);/)
 assert.match(latest,/\.stock-lot-modal \.stock-lot-actions \.btn\.primary\s*\{[^}]*grid-column:auto;/s)
})
