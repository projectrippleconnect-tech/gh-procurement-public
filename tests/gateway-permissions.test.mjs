import test from 'node:test'
import assert from 'node:assert/strict'
import {hasGatewayPermission} from '../lib/waha-rfq.js'
test('gateway accepts actual Supabase permission rows and legacy strings',()=>{
 const key='procurement.orders.edit'
 assert.equal(hasGatewayPermission([{permission_key:key}],key),true)
 assert.equal(hasGatewayPermission([key],key),true)
})
test('gateway denies absent, malformed and unrelated grants',()=>{
 const key='procurement.orders.edit'
 for(const value of [null,{},[],[null,{},true],[{permission_key:'procurement.orders.view'}],['admin']])assert.equal(hasGatewayPermission(value,key),false)
})
