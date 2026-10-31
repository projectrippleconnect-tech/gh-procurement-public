import test from 'node:test'
import assert from 'node:assert/strict'
import {wahaGatewayConfig} from '../lib/waha-gateway.mjs'

const base={WAHA_API_KEY:'fixture-only',WAHA_SESSION:'default',WAHA_ALLOWED_ORIGINS:'https://gateway.example.net'}
test('Netlify can use an explicitly pinned authenticated HTTPS gateway',()=>{
 const config=wahaGatewayConfig({...base,WAHA_BASE_URL:'https://gateway.example.net/'})
 assert.deepEqual(config,{base:'https://gateway.example.net',key:'fixture-only',session:'default'})
 assert.equal(wahaGatewayConfig({...base,WAHA_ALLOWED_ORIGINS:'',WAHA_BASE_URL:'https://gateway.example.net'}),null)
 assert.equal(wahaGatewayConfig({...base,WAHA_BASE_URL:'https://other.example.net'}),null)
})
test('invalid public URLs and untrusted origins never receive the API key',()=>{
 for(const raw of ['http://gateway.example.net','https://user:pass@gateway.example.net','https://gateway.example.net/api','https://gateway.example.net/?key=x','https://gateway.example.net/#x','https://127.0.0.2','https://[::1]','https://gateway.local','file:///etc/passwd']){
  const origin=new URL(raw).origin
  assert.equal(wahaGatewayConfig({...base,WAHA_ALLOWED_ORIGINS:origin,WAHA_BASE_URL:raw}),null,raw)
 }
 assert.equal(wahaGatewayConfig({...base,WAHA_BASE_URL:'https://gateway.example.net',WAHA_API_KEY:''}),null)
 assert.equal(wahaGatewayConfig({...base,WAHA_BASE_URL:'https://gateway.example.net',WAHA_SESSION:'../other'}),null)
})
test('existing private and local gateway fixtures retain compatibility',()=>{
 for(const raw of ['http://gateway.railway.internal:8080','http://localhost:3000','http://127.0.0.1:3000'])assert.ok(wahaGatewayConfig({...base,WAHA_BASE_URL:raw}))
})
