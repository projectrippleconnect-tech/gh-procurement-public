import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=readFileSync(new URL('../components/modules-company.jsx',import.meta.url),'utf8')
const css=readFileSync(new URL('../app/globals.css',import.meta.url),'utf8')
const companySource=source.slice(source.indexOf('export function CompanyLists'),source.indexOf('export function CompanyPriceLists'))

test('Company header opens Review Lot; only reviewed modal may finalize',()=>{
 assert.match(companySource,/onClick=\{\(\)=>\{setCompanyHistoryOpen\(false\);setCompanyReviewOpen\(true\)\}\}/)
 assert.match(companySource,/Review Lot · \{countTotal\}/)
 assert.match(companySource,/className="modal card stock-lot-modal company-lot-modal"/)
 assert.match(companySource,/Finalize · '\+countTotal/)
 assert.equal([...companySource.matchAll(/onClick=\{submit\}/g)].length,1)
})
test('Company stock history and previously finalized markers use owner-scoped RPC',()=>{
 assert.match(companySource,/proc_stock_submission_history_v1/)
 assert.match(companySource,/proc_stock_submission_detail_v1/)
 assert.match(companySource,/h\.counted_by===profile\.id/)
 assert.match(companySource,/companyMarker\(r\)/)
 assert.match(companySource,/alreadyFinalized\?<button/)
 assert.match(companySource,/allowCompanyRecount\(r\)/)
 assert.match(companySource,/companyHistoryReady/)
})
test('Company stock review controls are one compact row and stock items scroll independently',()=>{
 const recent=css.slice(css.indexOf('/* Company Stock uses the same compact'))
 assert.match(recent,/grid-template-columns:minmax\(0,1fr\) minmax\(0,\.82fr\) minmax\(0,1\.12fr\)/)
 assert.match(recent,/\.company-lot-modal>\.stock-lot-rows\{[^}]*overflow-y:auto/s)
 assert.match(recent,/min-height:34px;height:34px/)
 assert.ok(companySource.indexOf('className="stock-lot-actions"')<companySource.indexOf('className="stock-lot-rows company-lot-history"'))
})
test('Company finalization preserves idempotent keys and rejects unverified recent history',()=>{
 assert.match(companySource,/if\(!companyHistoryReady\)return fail/)
 assert.match(companySource,/if\(companyLotBlocked\.length\)return fail/)
 assert.match(companySource,/if\(oversizedCompanyLot\)return fail/)
 assert.match(companySource,/if\(submitLock\.current\)return/)
 assert.match(companySource,/submissionId,companyId:group\.id/)
})
