import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
function worker(){const handlers={},shown=[],opened=[];const self={location:{origin:'https://gh-procurement.netlify.app'},addEventListener:(name,fn)=>handlers[name]=fn,skipWaiting(){},registration:{showNotification:async(...args)=>shown.push(args)},clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>opened.push(url)}};vm.runInNewContext(fs.readFileSync(new URL('../public/admin-push-sw.js',import.meta.url),'utf8'),{self,URL});return {handlers,shown,opened}}
test('background pushes produce an OS notification with a stable event tag',async()=>{const w=worker();let done;w.handlers.push({data:{json:()=>({title:'Stock submitted',body:'Handler submitted 001',tag:'stock:001',url:'/?notification=123'})},waitUntil:p=>done=p});await done;assert.equal(w.shown[0][0],'Stock submitted');assert.equal(w.shown[0][1].tag,'stock:001');assert.equal(w.shown[0][1].data.url,'/?notification=123')})
test('notification clicks cannot open an external site',async()=>{const w=worker();w.handlers.notificationclick({notification:{close(){},data:{url:'https://evil.example'}},waitUntil(){throw Error('External navigation')}});assert.equal(w.opened.length,0)})
test('notification clicks open the app with the alert identifier',async()=>{const w=worker();let done;w.handlers.notificationclick({notification:{close(){},data:{url:'/?notification=123'}},waitUntil:p=>done=p});await done;assert.equal(w.opened[0],'https://gh-procurement.netlify.app/?notification=123')})
