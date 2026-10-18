import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {visibleWorkflowStages} from '../lib/workflow-visibility.mjs'

function screens(...keys){
 const allowed=new Set(keys)
 return view=>visibleWorkflowStages(view,key=>allowed.has(key))
}

test('stock-only staff see no process strip and no implied steps',()=>{
 assert.deepEqual(screens('stock')('stock'),[])
 assert.deepEqual(screens('stock')('requirements'),[])
})
test('single-purpose receiver sees no procurement stage hints',()=>{
 assert.deepEqual(screens('receiving')('receiving'),[])
})
test('mixed permissions expose only the stages actually granted',()=>{
 const nav=screens('stock','requirements')
 assert.deepEqual(nav('stock').map(s=>s[0]),['Stock','Review'])
 assert.deepEqual(nav('requirements').map(s=>s[0]),['Stock','Review'])
 assert.deepEqual(nav('rfq'),[])
})
test('admins retain all five stages without exposing stages on unrelated screens',()=>{
 const nav=screens('stock','requirements','rfq','po','receiving')
 assert.deepEqual(nav('stock').map(s=>s[0]),['Stock','Review','Prices','Order','Receive'])
 assert.deepEqual(nav('dashboard'),[])
})
test('shared UI does not label or mount disabled workflow stages',()=>{
 const ui=readFileSync(new URL('../components/ui.jsx',import.meta.url),'utf8')
 assert.match(ui,/visibleWorkflowStages\(view,canNavigate\)/)
 assert.match(ui,/if\(!stages\.length\)return null/)
 assert.doesNotMatch(ui,/unavailable for your role|disabled=\{!canNavigate\(target\)\}/)
})
test('stock confirmation and save messages are neutral for stock-only users',()=>{
 const stock=readFileSync(new URL('../components/modules-stock.jsx',import.meta.url),'utf8')
 assert.match(stock,/const canSeeReview=canNavigate\('requirements'\)/)
 assert.match(stock,/if\(!canSeeReview\)message\+=lot\.count\+' item\(s\) saved\.'/)
 assert.doesNotMatch(stock,/submission\.needsReview&&!canNavigate\('requirements'\)/)
})
