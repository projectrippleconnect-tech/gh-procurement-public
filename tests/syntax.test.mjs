import test from 'node:test'
import assert from 'node:assert/strict'
import {readdirSync,readFileSync} from 'node:fs'
import ts from 'typescript'
import {execFileSync} from 'node:child_process'

test('every JavaScript and JSX module parses before release',()=>{
  for(const dir of ['components','lib'])for(const filename of readdirSync(dir)){
    if(!/\.jsx?$/.test(filename))continue
    const path=dir+'/'+filename
    const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,
      filename.endsWith('.jsx')?ts.ScriptKind.JSX:ts.ScriptKind.JS)
    assert.deepEqual(source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[],path)
  }
})

test('browser and build scripts pass native JavaScript syntax validation',()=>{
 for(const dir of ['tests','scripts'])for(const filename of readdirSync(dir)){
  if(!filename.endsWith('.mjs'))continue
  assert.doesNotThrow(()=>execFileSync(process.execPath,['--check',dir+'/'+filename],{stdio:'pipe'}),dir+'/'+filename)
 }
})

test('auth state notifications do not await calls on the locked client',()=>{
  const app=readFileSync('components/procurement-app.jsx','utf8')
  assert.doesNotMatch(app,/onAuthStateChange\(async/)
  const callback=app.slice(app.indexOf('onAuthStateChange('),app.indexOf('return()=>data.subscription.unsubscribe()'))
  assert.doesNotMatch(callback,/await|ensure\(|loadConfig\(|loadPermissions\(/)
})
