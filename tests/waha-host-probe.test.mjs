import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createProbe,initializeStorage} from '../hosting/gh-waha-host-probe/server.mjs'

test('host probe reports persisted ID across app restart without WhatsApp credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gh-host-probe-'))
 try{
  const before=initializeStorage(dir),after=initializeStorage(dir)
  assert.equal(before.storage,'writable')
  assert.equal(before.marker,after.marker)
  const probe=createProbe({storage:before,key:'test-secret'})
  await new Promise(resolve=>probe.server.listen(0,'127.0.0.1',resolve))
  const origin='http://127.0.0.1:'+probe.server.address().port
  try{
   const health=await (await fetch(origin+'/health')).json()
   assert.equal(health.ok,true)
   assert.equal(health.storage,'writable')
   assert.equal(health.marker,before.marker)
   const noKey=await fetch(origin+'/api/probe',{method:'POST'})
   assert.equal(noKey.status,401)
   const wrong=await fetch(origin+'/api/probe',{method:'POST',headers:{'x-probe-key':'wrong'}})
   assert.equal(wrong.status,401)
   const valid=await fetch(origin+'/api/probe',{method:'POST',headers:{'x-probe-key':'test-secret'}})
   assert.equal(valid.status,200)
   assert.deepEqual(await valid.json(),{ok:true,request:'authenticated'})
   assert.equal((await fetch(origin+'/api/sendImage',{method:'POST'})).status,404)
  }finally{await new Promise(resolve=>probe.server.close(resolve))}
 }finally{rmSync(dir,{recursive:true,force:true})}
})
