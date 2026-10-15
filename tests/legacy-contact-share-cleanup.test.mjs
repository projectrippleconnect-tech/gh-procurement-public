import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'

test('retirement worker deletes only obsolete contact caches and unregisters without intercepting traffic',async()=>{
 const handlers={},deleted=[];let unregistered=false
 vm.runInNewContext(readFileSync(new URL('../public/gh-contact-share-sw.js',import.meta.url),'utf8'),{
  self:{addEventListener:(name,handler)=>handlers[name]=handler,registration:{unregister:async()=>{unregistered=true}}},caches:{delete:async name=>deleted.push(name)}
 })
 let completion;handlers.activate({waitUntil:p=>completion=p});await completion
 assert.deepEqual(deleted,['gh-procurement-contact-shares-v1','gh-procurement-contact-shares-v2'])
 assert.equal(unregistered,true)
 assert.equal(handlers.fetch,undefined)
})
