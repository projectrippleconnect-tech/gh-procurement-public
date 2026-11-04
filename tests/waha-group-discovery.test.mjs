import test from 'node:test'
import assert from 'node:assert/strict'
import {parseWahaGroups,parseWahaChats,groupMatches,wahaResponseShape} from '../lib/waha-group-discovery.mjs'
const RFQ='120363111111111@g.us',PO='120363222222222@g.us'
test('GOWS and NOWEB keyed group objects retain group identity and subject',()=>{
 const data={[RFQ]:{id:RFQ,subject:'RFQ'},[PO]:{id:PO,subject:'PO'},'nonsense':{id:'999@c.us',subject:'Unknown'}}
 const r=parseWahaGroups(data)
 assert.equal(r.recognized,true)
 assert.deepEqual(groupMatches(r.items).map(g=>g.name),['RFQ','PO'])
});
test('GOWS map entries with key-only IDs are not lost',()=>{
 const x=parseWahaGroups({groups:{[PO]:{name:'PO'},[RFQ]:{subject:'RFQ'}}})
 assert.equal(x.recognized,true)
 assert.deepEqual(x.items.map(y=>y.id),[PO,RFQ])
});
test('array and wrapped groups normalize, partial metadata remains visible',()=>{
 const list=[{id:RFQ,subject:'RFQ'},{id:PO},{id:'123@c.us',name:'Personal'}]
 for(const raw of [list,{items:list},{groups:list},{data:list}]){
  const p=parseWahaGroups(raw)
  assert.equal(p.recognized,true)
  assert.equal(p.items.length,2)
  assert.equal(p.items.filter(x=>!x.name).length,1)
 }
});
test('malformed response must not be mistaken for an empty but valid group list',()=>{
 assert.equal(parseWahaGroups(null).recognized,false)
 assert.equal(parseWahaGroups('bad').recognized,false)
 assert.equal(parseWahaGroups({}).recognized,true)
 assert.equal(parseWahaGroups([]).recognized,true)
});
test('read-only chats can discover named groups without returning direct chats',()=>{
 const input={items:[{id:RFQ,name:'rfq '},{id:PO,name:'PO'},{id:'94770000001@c.us',name:'Private'}]}
 const entries=groupMatches(parseWahaChats(input))
 assert.deepEqual(entries.map(x=>x.id),[RFQ,PO])
});


test('WAHA nested results and GOWS JID object both produce real group IDs',()=>{
 const raw={results:[{group:{id:{user:'120363444444444',server:'g.us'},subject:'RFQ'}},{groupInfo:{JID:{User:'120363555555555',Server:'g.us'},Subject:'PO'}}]}
 const ids=groupMatches(parseWahaGroups(raw).items)
 assert.deepEqual(ids.map(x=>x.id),['120363444444444@g.us','120363555555555@g.us'])
});
test('Response-shape diagnostics reveal only field names, masking invitation and identity keys',()=>{
 const secret='120363345678901@g.us'
 const shape=wahaResponseShape({[secret]:{id:secret,subject:'RFQ',participants:[{phone:'+94770000000'}]}})
 const text=JSON.stringify(shape)
 assert.ok(!text.includes(secret))
 assert.ok(!text.includes('94770000000'))
 assert.match(text,/identifier/)
 assert.match(text,/subject/)
});
test('Groups with unknown wrappers are classified as recognized shape, but not mistaken for named groups',()=>{
 const parsed=parseWahaGroups({count:753,results:{records:[{id:{user:'120363333333333',server:'g.us'}}]}})
 assert.equal(parsed.recognized,true)
 assert.equal(parsed.items.length,1)
 assert.equal(parsed.items[0].name,'')
});
