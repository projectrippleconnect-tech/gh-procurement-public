import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {gatewayConfig} from '../lib/waha-gateway-config.js'

const base={WAHA_API_KEY:'secret',WAHA_SESSION:'default',NODE_ENV:'production'}
const config=overrides=>gatewayConfig({...base,...overrides})

test('accepts existing private Railway endpoint without affecting production',()=>{
 assert.deepEqual(config({WAHA_BASE_URL:'http://gh-procurement-waha-gows.railway.internal:3000'}),{
  base:'http://gh-procurement-waha-gows.railway.internal:3000',key:'secret',session:'default'
 })
})

test('accepts only a specifically allowed public HTTPS hostname',()=>{
 const valid='https://gateway.example.org'
 assert.deepEqual(config({WAHA_BASE_URL:valid,WAHA_ALLOWED_HOST:'gateway.example.org'}),{
  base:valid,key:'secret',session:'default'
 })
 for(const url of [
  'http://gateway.example.org','https://evil.example.org',
  'https://gateway.example.org.evil.tld','https://127.0.0.1',
  'https://localhost','https://gateway.example.org:8443',
  'https://gateway.example.org/admin','https://gateway.example.org/?x=1',
  'https://gateway.example.org/#fragment','https://admin:pass@gateway.example.org'
 ])assert.equal(config({WAHA_BASE_URL:url,WAHA_ALLOWED_HOST:'gateway.example.org'}),null,url)
 assert.equal(config({WAHA_BASE_URL:valid}),null,'missing operator allowlist')
 assert.equal(config({WAHA_BASE_URL:valid,WAHA_ALLOWED_HOST:'*.example.org'}),null)
})

test('rejects malformed, unconfigured, or unsafe gateway settings',()=>{
 assert.equal(config({WAHA_BASE_URL:'http://localhost:3000'}),null)
 assert.equal(config({WAHA_BASE_URL:'http://127.0.0.1:3000'}),null)
 assert.equal(config({WAHA_BASE_URL:'http://evil-railway.internal.example.com'}),null)
 assert.equal(config({WAHA_BASE_URL:'https://host.internal',WAHA_ALLOWED_HOST:'host.internal'}),null)
 assert.equal(config({WAHA_BASE_URL:'http://x.railway.internal:3000',WAHA_SESSION:'bad session'}),null)
 assert.equal(config({WAHA_BASE_URL:'http://x.railway.internal:3000',WAHA_API_KEY:''}),null)
 assert.equal(config({WAHA_BASE_URL:'not a URL'}),null)
})

test('allows localhost only outside production for local integration tests',()=>{
 const local={WAHA_BASE_URL:'http://127.0.0.1:3000',NODE_ENV:'test'}
 assert.equal(config(local)?.base,'http://127.0.0.1:3000')
})


test('pairing and supplier dispatch routes reject untrusted WAHA redirects',()=>{
 for(const path of [
  'app/api/integrations/whatsapp/pair/route.ts',
  'app/api/integrations/whatsapp/rfq/route.ts',
  'app/api/integrations/whatsapp/po/route.ts'
 ]){
  const source=readFileSync(new URL('../'+path,import.meta.url),'utf8')
  const calls=(source.match(/await fetch\(/g)||[]).length
  const guards=(source.match(/redirect:'error'/g)||[]).length
  assert.ok(calls>0,path+' must call the gateway')
  assert.equal(guards,calls,path+' must reject redirects for every WAHA request')
 }
})
