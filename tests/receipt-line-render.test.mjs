import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import ts from 'typescript'
import * as flow from '../lib/procurement-flow.js'
import * as inspection from '../lib/receipt-inspection.mjs'
const require=createRequire(import.meta.url)
function compile(path,resolve){
 const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
 const module={exports:{}};vm.runInNewContext(code,{exports:module.exports,module,require:resolve});return module.exports
}
const helpers=compile('../lib/helpers.ts',require)
const {ReceiptLine}=compile('../components/receipt-line.jsx',name=>name==='@/lib/helpers'?helpers:name==='@/lib/procurement-flow'?flow:name==='@/lib/receipt-inspection.mjs'?inspection:require(name))
const line={id:'line',qty:20,cancelled_qty:0,item:{description:'BRASS ELBOW',size:'2 INCH',uom:'PCS'},grn:[]}
const render=value=>renderToStaticMarkup(React.createElement(ReceiptLine,{line,value,show:()=>true,onChange:()=>{},onFull:()=>{},full:false,disabled:false}))
test('responsive receiving has one input per quantity and explicitly labels acceptance',()=>{
 const html=render({received:'8',accepted:'',rejected:'0',reason:''})
 assert.equal((html.match(/aria-label="Received /g)||[]).length,1)
 assert.equal((html.match(/aria-label="Accepted /g)||[]).length,1)
 assert.match(html,/All accepted/);assert.match(html,/Full delivery accepted/)
 assert.match(html,/<details[^>]*open=""/,'uninspected goods reveal the required breakdown')
 assert.doesNotMatch(html,/checked=""/,'receipt entry alone does not confirm acceptance')
})
test('all-accepted goods collapse detail but rejected goods keep inspection visible',()=>{
 const accepted=render({received:'8',accepted:'8',rejected:'0',reason:''})
 assert.doesNotMatch(accepted,/<details[^>]*open=/)
 assert.match(accepted,/aria-label="All accepted [^"]+"[^>]*checked=""/)
 const rejected=render({received:'8',accepted:'6',rejected:'2',reason:'Damaged'})
 assert.match(rejected,/<details[^>]*open=""/);assert.match(rejected,/2 rejected/);assert.match(rejected,/value="Damaged"/)
})
