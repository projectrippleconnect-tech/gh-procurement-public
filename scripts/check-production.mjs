// Read-only checks: no login, messages or business records are created.
import assert from 'node:assert/strict'
const root=process.env.GH_PRODUCTION_URL||'https://gh-procurement.netlify.app'
const target=new URL(root)
assert.ok(target.protocol==='https:'||(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)),'Use HTTPS for hosted release checks')
assert.ok(!target.username&&!target.password&&!target.search&&!target.hash,'Release URL must not contain credentials, query parameters or fragments')
async function request(path,options={}){
 const response=await fetch(root+path,{...options,signal:AbortSignal.timeout(15000)})
 return response
}
const health=await request('/api/health')
assert.equal(health.status,200,'Production health failed')
const state=await health.json()
assert.ok(state.ok&&state.database==='connected'&&state.schema_ready,'Database or schema unavailable')
const login=await request('/')
assert.equal(login.status,200,'Login unavailable')
assert.match(login.headers.get('content-security-policy')||'',/nonce-/,'Missing script nonce')
assert.match(login.headers.get('cache-control')||'',/no-store/,'Login must not be cached')
await login.body?.cancel()
const language=await request('/tesseract-data/eng.traineddata.gz',{method:'HEAD'})
assert.equal(language.status,200,'OCR language file unavailable')
const blocked=await request('/api/integrations/whatsapp/rfq',{
 method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
})
assert.equal(blocked.status,401,'Unauthenticated sending must be rejected')
await blocked.body?.cancel()
console.log('PASS production health, database schema, login security, OCR asset and unauthenticated sending boundary; version '+state.version)
