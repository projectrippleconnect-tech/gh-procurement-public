import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'

// Exercise the component's actual submit handler with isolated API/storage adapters.
// No production records or WhatsApp calls are made.
const source=readFileSync('components/modules-company.jsx','utf8')
const start=source.indexOf(' async function submit(){',source.indexOf('export function CompanyLists'))
const submitSource=source.slice(start,source.indexOf('\n\n return <>',start))
function fixture(){
 const calls=[],errors=[],storage=new Map(),results=[]
 const state={entry:{a:'0',b:'5'},sufficient:{},failCompany:null}
 const scope={
  canCount:true,busy:false,allCompanies:true,companyId:'all',
  companies:[{id:'A'},{id:'B'},{id:'C'}],
  rows:[{id:'a',company_id:'A'},{id:'b',company_id:'B'},{id:'blank',company_id:'C'}],
  entry:state.entry,sufficient:state.sufficient,draftKey:'draft',startedAt:{current:'2026-10-17T08:00:00Z'},
  isQuantityInput:v=>/^\d+(\.\d+)?$/.test(v),t:(_,fallback)=>fallback,
  confirmAction:async()=>true,setBusy:()=>{},
  crypto:{randomUUID:()=>crypto.randomUUID()},
  localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
  companyApi:async(_,body)=>{calls.push(structuredClone(body));if(body.companyId===state.failCompany)throw new Error('Fixture unavailable');return {count_no:body.companyId,purchase_orders:[],rfqs:[]}},
  setEntry:v=>{scope.entry=v;state.entry=v},setSufficient:v=>{scope.sufficient=v;state.sufficient=v},
  setSubmissionResult:v=>results.push(v),flash:()=>{},fail:e=>errors.push(e.message),
  companySubmissionMessage:()=>'',loadRows:async()=>{}
 }
 vm.createContext(scope)
 const submit=vm.runInContext('('+submitSource+')',scope)
 return {submit,state,calls,errors,storage,results}
}
test('All Companies submits zero and positive counts to their own company, skipping blanks',async()=>{
 const f=fixture();await f.submit()
 assert.deepEqual(f.errors,[])
 assert.deepEqual(f.calls.map(x=>[x.companyId,x.lines.map(l=>[l.company_list_item_id,l.current_stock])]),[['A',[['a',0]]],['B',[['b',5]]]])
 assert.notEqual(f.calls[0].submissionId,f.calls[1].submissionId)
 assert.deepEqual(Object.keys(f.state.entry),[])
 assert.equal(f.storage.has('draft'),false)
 assert.equal(f.results.at(-1).results.length,2)
})
test('a partial company failure retains unsaved counts and reuses the failed submission ID',async()=>{
 const f=fixture();f.state.failCompany='B';await f.submit()
 assert.deepEqual(f.errors,['Fixture unavailable'])
 assert.deepEqual(Object.keys(f.state.entry),['b'])
 assert.equal(JSON.parse(f.storage.get('draft')).entry.b,'5')
 const retryId=f.calls[1].submissionId
 f.state.failCompany=null;await f.submit()
 assert.deepEqual(f.calls.map(c=>c.companyId),['A','B','B'])
 assert.equal(f.calls[2].submissionId,retryId)
 assert.deepEqual(Object.keys(f.state.entry),[])
})
test('sufficient-stock selections retain the correct company and do not submit a numeric count',async()=>{
 const f=fixture();f.state.sufficient.a=true;await f.submit()
 assert.equal(f.calls[0].companyId,'A')
 assert.equal(f.calls[0].lines[0].sufficient_stock,true)
 assert.equal(f.calls[0].lines[0].current_stock,null)
})
