import test from 'node:test'
import assert from 'node:assert/strict'
import {DEFAULT_ACCESS_POLICY,validateAccessPolicy,accessMessage} from '../lib/access-restrictions.mjs'
test('access settings reject invalid schedules and coordinates',()=>{
 assert.equal(validateAccessPolicy(DEFAULT_ACCESS_POLICY),null)
 for(const patch of [{days:[]},{days:[7]},{start_time:'18:30',end_time:'07:30'},{start_time:'24:00'},{latitude:NaN},{longitude:181},{radius_m:0}]){
  assert.ok(validateAccessPolicy({...DEFAULT_ACCESS_POLICY,...patch}))
 }
})
test('each failed access check gives a usable locked-screen explanation',()=>{
 for(const reason of ['outside_hours','outside_location','permission_denied','inaccurate_location','location_unavailable','disabled','connection_error'])assert.ok(accessMessage(reason).length>20)
})
