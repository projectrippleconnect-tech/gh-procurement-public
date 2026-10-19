import test from 'node:test'
import assert from 'node:assert/strict'
import {validateStockSubmission,isDisconnected} from '../lib/offline-stock.mjs'

const general={ownerId:'user-1',kind:'general',lines:[{item_id:'abc',current_stock:0,sufficient_stock:false}]}
const company={ownerId:'user-1',kind:'company',companyId:'company-1',lines:[{company_list_item_id:'abc',current_stock:null,sufficient_stock:true}]}
test('validates general, company and zero-stock operations',()=>{
 assert.equal(validateStockSubmission(general),true)
 assert.equal(validateStockSubmission(company),true)
})
test('rejects duplicate lines and unsafe quantities',()=>{
 assert.throws(()=>validateStockSubmission({...general,lines:[...general.lines,...general.lines]}),/duplicated/)
 assert.throws(()=>validateStockSubmission({...general,lines:[{item_id:'abc',current_stock:-1}]}),/Invalid counted/)
 assert.throws(()=>validateStockSubmission({...company,companyId:null}),/Choose a company/)
 assert.throws(()=>validateStockSubmission({...general,lines:[]}),/1–1000/)
})
test('does not incorrectly report offline in non-browser unit tests',()=>{
 assert.equal(isDisconnected(),false)
})
