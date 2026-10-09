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
