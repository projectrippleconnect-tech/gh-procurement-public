import {createRequire} from 'node:module'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const ts=require('typescript')
function moduleAt(path,scope={}){
 const m={exports:{}}
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 new Function('module','exports',...Object.keys(scope),code)(m,m.exports,...Object.values(scope))
 return m.exports
}
test('production CSP authorizes nonce scripts without unrestricted inline execution',()=>{
 const {contentSecurityPolicy}=moduleAt('lib/content-security-policy.ts')
 const policy=contentSecurityPolicy({nonce:'fixtureRandomNonce=='})
 const scripts=policy.split('; ').find(x=>x.startsWith('script-src '))
 assert.match(scripts,/'nonce-fixtureRandomNonce=='/)
 assert.match(scripts,/'strict-dynamic'/)
 assert.match(scripts,/'wasm-unsafe-eval'/)
 assert.doesNotMatch(scripts,/'unsafe-inline'|'unsafe-eval'/)
 assert.doesNotMatch(contentSecurityPolicy(),/'nonce-/)
 assert.throws(()=>contentSecurityPolicy({nonce:"x'; script-src *"}),/Invalid CSP nonce/)
})
test('CSV cells cannot execute supplier-provided spreadsheet formulas',async()=>{
 let exported
 const helpers=moduleAt('lib/helpers.ts',{URL:{createObjectURL(blob){exported=blob;return 'blob:fixture'},revokeObjectURL(){}},
  document:{createElement(){return {click(){}}}}})
 helpers.downloadCsv('fixture.csv',[{name:'=HYPERLINK("https://example.invalid")',rate:-12,remarks:'  +SUM(1,2)'}])
 const csv=await exported.text()
 assert.match(csv,/"'=HYPERLINK/)
 assert.match(csv,/"'  \+SUM/)
 assert.match(csv,/"-12"/)
})
test('health reports the Railway commit and fails closed on database outage',async()=>{
 const process={env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-fixture',
  RAILWAY_GIT_COMMIT_SHA:'release-fixture'}}
 let signal
 const health=moduleAt('app/api/health/route.ts',{process,fetch:async(url,opts)=>{
  signal=opts.signal
  return Response.json({database:'connected',schema_ready:true})
 }})
 const response=await health.GET()
 assert.equal(response.status,200)
 assert.equal((await response.json()).version,'release-fixture')
 assert.ok(signal instanceof AbortSignal)
 const outage=moduleAt('app/api/health/route.ts',{process,fetch:async()=>{throw new Error('offline')}})
 assert.equal((await outage.GET()).status,503)
})
test('gateway preserves the full allowed caption',async()=>{
 const {wahaImagePayload}=await import('../lib/waha-rfq.js')
 const caption='x'.repeat(1800)
 assert.equal(wahaImagePayload({phone:'+94779792078',caption}).caption,caption)
})

test('business dates follow Sri Lanka midnight rather than UTC or device timezone',()=>{
 const {businessDate}=moduleAt('lib/helpers.ts')
 assert.equal(businessDate(new Date('2026-10-09T18:29:59Z')),'2026-10-09')
 assert.equal(businessDate(new Date('2026-10-09T18:30:00Z')),'2026-10-10')
 assert.equal(businessDate(new Date('2026-12-31T18:30:00Z')),'2027-01-01')
})

test('complete dataset queries traverse the API cap and do not return partial success',async()=>{
 const {allRows}=await import('../lib/query-pages.js')
 const rows=Array.from({length:1201},(_,id)=>({id})),ranges=[]
 const result=await allRows(()=>({async range(from,to){ranges.push([from,to]);return {data:rows.slice(from,to+1),error:null}}}))
 assert.deepEqual(result.data,rows)
 assert.deepEqual(ranges,[[0,499],[500,999],[1000,1499]])
 const failure={message:'Second page unavailable'}
 const failed=await allRows(()=>({async range(from){return from===0?{data:rows.slice(0,500),error:null}:{data:null,error:failure}}}))
 assert.equal(failed.error,failure)
 assert.deepEqual(failed.data,[])
})


test('search filter punctuation stays inside quoted PostgREST values',async()=>{
 const {containsAny}=await import('../lib/query-pages.js')
 for(const term of ['bolt, nut','ATLAS (120)','2 inch \"paper\"',String.raw`pipe\joint`,'size.eq.0),active.eq.false']){
  const filter=containsAny(['description','item_code','size'],term)
  const values=filter.match(/\"(?:[^\"\\]|\\.)*\"/g)
  assert.equal(values.length,3)
  for(const value of values)assert.equal(JSON.parse(value),'%'+term+'%')
 }
})
