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
 assert.deepEqual(nav('stock'),[])
 assert.deepEqual(nav('requirements'),[])
 assert.deepEqual(nav('rfq'),[])
})
test('admins see the three document sections only within purchasing',()=>{
 const nav=screens('stock','requirements','rfq','po','receiving')
 assert.deepEqual(nav('stock'),[])
 assert.deepEqual(nav('rfq').map(s=>s[0]),['Review','Quotes','Orders'])
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
 assert.match(stock,/stockSubmissionOutcome\(r\.data,\{purchaseVisible:canSeeReview\}\)/)
 assert.doesNotMatch(stock,/submission\.needsReview&&!canNavigate\('requirements'\)/)
})
