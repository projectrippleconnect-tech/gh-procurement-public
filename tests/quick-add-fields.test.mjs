import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import ts from 'typescript'
import {quickAddReorderLevel} from '../lib/quick-add-reorder.mjs'
import {itemOptionValues,updateItemGrouping} from '../lib/item-editor-options.mjs'
import {uppercaseItemText,uppercaseItemAttributes} from '../lib/item-text.mjs'

const code=ts.transpileModule(readFileSync(new URL('../components/quick-add-item.jsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment'}}).outputText

for(const mode of ['company','general'])for(const fresh of [false,true])test(`${mode} quick create saves ${fresh?'new':'existing'} company context without duplicate fields`,async()=>{
 let index=0,payload,linked
 const errors=[]
 const sandbox={exports:{},Fragment:'fragment',h:(type,props,...children)=>({type,props:props||{},children}),require:name=>{
  if(name==='react')return {useEffect:()=>{},useState:init=>{
   const i=index++
   return [i===0?true:i===1?{...init,description:'SOLD SHEET',max_stock:'10'}:i===3?(fresh?'__new__':'board'):i===4?{name:'New Company',code:''}:init,()=>{}]
  }}
  if(name==='@/lib/supabase')return {supabase:{rpc:async(name,args)=>{payload=args.p_item;return {data:{item:{id:'item'}}}}}}
  if(name.includes('quick-add-reorder'))return {quickAddReorderLevel}
  if(name.includes('item-editor-options'))return {itemOptionValues,updateItemGrouping}
  if(name.includes('item-text'))return {uppercaseItemText,uppercaseItemAttributes}
  return {ModernSelect:'select'}
 }}
 vm.runInNewContext(code,sandbox)
 const tree=sandbox.exports.QuickAddItem({mode,can:()=>true,fail:e=>errors.push(e),flash:()=>{},companies:[{id:'board',name:'BOARD ITEMS'}],onCreated:async(item,meta)=>{linked=meta},onCreateCompany:async()=>({id:'new'})})
 const nodes=[]
 const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(node&&typeof node==='object'){nodes.push(node);walk(node.children)}}
 walk(tree)
 for(const label of ['Category','Main group','Subcategory'])assert.equal(nodes.some(node=>node.props['aria-label']===label),mode==='general')
 assert.equal(nodes.some(node=>node.props['aria-label']==='Company for new item'),mode==='company')
 assert.equal(nodes.some(node=>node.type==='button'&&node.children.includes('+ New category')),false)
 await nodes.find(node=>node.type==='button'&&node.props.className==='btn primary').props.onClick()
 assert.deepEqual(errors,[])
 assert.equal(payload.category,mode==='company'?(fresh?'NEW COMPANY':'BOARD ITEMS'):'GENERAL')
 assert.equal(payload.main_group,'')
 assert.equal(payload.subgroup,'')
 assert.equal(linked.companyId,mode==='company'?(fresh?'new':'board'):null)
 assert.equal(payload.max_stock,10)
})
