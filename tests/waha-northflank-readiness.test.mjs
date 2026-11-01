import test from 'node:test'
import assert from 'node:assert/strict'
import {validateWahaReadinessEnvironment,inspectWahaGateway} from '../scripts/qa/waha-gateway-readonly.mjs'

const config={
 WAHA_BASE_URL:'https://waha--gh-procurement--example.code.run',
 WAHA_ALLOWED_ORIGINS:'https://waha--gh-procurement--example.code.run',
 WAHA_API_KEY:'fixture-private-api-key',
 WAHA_SESSION:'default'
}

test('new WAHA diagnostic rejects missing, unpinned and insecure gateway settings',()=>{
 assert.equal(validateWahaReadinessEnvironment({}).reason,'missing_gateway_environment')
 assert.equal(validateWahaReadinessEnvironment({...config,WAHA_BASE_URL:'http://waha--gh-procurement--example.code.run'}).reason,'unsafe_gateway_origin')
 assert.equal(validateWahaReadinessEnvironment({...config,WAHA_ALLOWED_ORIGINS:'https://different.example'}).reason,'unsafe_gateway_origin')
 assert.equal(validateWahaReadinessEnvironment({...config,WAHA_BASE_URL:'https://example.com/path'}).reason,'unsafe_gateway_origin')
 assert.equal(validateWahaReadinessEnvironment({...config,WAHA_BASE_URL:'https://127.0.0.1'}).reason,'unsafe_gateway_origin')
 assert.equal(validateWahaReadinessEnvironment({...config,WAHA_SESSION:'bad/session'}).reason,'invalid_session_name')
 assert.deepEqual(validateWahaReadinessEnvironment(config),{ok:true,origin:config.WAHA_BASE_URL,session:'default'})
})
test('new WAHA diagnostic does only an authenticated HTTPS GET; never sends supplier messages',async()=>{
 let invoked=0
 const result=await inspectWahaGateway(config,async(url,options)=>{
  invoked++
  assert.equal(url,config.WAHA_BASE_URL+'/api/sessions/default')
  assert.equal(options.method,'GET')
  assert.equal(options.headers['X-Api-Key'],config.WAHA_API_KEY)
  assert.equal(options.redirect,'error')
  return {ok:true,json:async()=>({status:'WORKING',me:{id:'private-fixture'}})}
 })
 assert.equal(invoked,1)
 assert.deepEqual(result,{ready:true,session:'default',status:'WORKING',reason:'session_connected'})
 assert.equal(JSON.stringify(result).includes(config.WAHA_API_KEY),false)
})
test('not connected, auth failures and transport errors fail closed',async()=>{
 assert.equal((await inspectWahaGateway(config,async()=>({ok:true,json:async()=>({status:'SCAN_QR_CODE'})}))).ready,false)
 assert.deepEqual(await inspectWahaGateway(config,async()=>({ok:false,status:401})),{ready:false,reason:'gateway_http_401'})
 assert.deepEqual(await inspectWahaGateway(config,async()=>{throw Error('secret network failure')}),{ready:false,reason:'gateway_connection_failed'})
})
