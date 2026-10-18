import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {inviteCodes,normalizeInviteInfo,preferredInviteRoles} from '../lib/waha-invite-info.mjs'
const id='120363123456789@g.us'
test('Read-only invite validation strips URL params and rejects other sites, duplicates and invalid codes',()=>{
 const codes=inviteCodes('https://chat.whatsapp.com/AAAABBBBCCCCDDDDEEEEFF?s=cl&p=a\nhttps://chat.whatsapp.com/AAAABBBBCCCCDDDDEEEEFF\nhttps://evil.chat.whatsapp.com/AAAAEEEECCCCBBBBFFFFGG\nhttps://chat.whatsapp.com/1234567890abcdefghijkl?x=1')
 assert.deepEqual(codes,['AAAABBBBCCCCDDDDEEEEFF','1234567890abcdefghijkl'])
});
test('WAHA join-info recognizes community and child subgroup identities',()=>{
 const rfq=normalizeInviteInfo({data:{id,subject:' RFQ ',size:1}})
 assert.deepEqual(rfq,{id,name:'RFQ',memberCount:1,isCommunity:false})
 assert.equal(preferredInviteRoles(rfq),'RFQ')
 const community=normalizeInviteInfo({group:{groupId:id,subject:'Gh Procurement',isCommunity:true}})
 assert.equal(community.isCommunity,true)
 assert.equal(preferredInviteRoles(community),null)
 const po=normalizeInviteInfo({result:{jid:id,groupName:'PO',participants:[{id:'a'}]}})
 assert.equal(po.memberCount,1)
 assert.equal(preferredInviteRoles(po),'PO')
});
test('Unknown identities fail closed without inventing an ID or participant count',()=>{
 assert.equal(normalizeInviteInfo({name:'PO'}),null)
 const unknown=normalizeInviteInfo({id,subject:'Other'})
 assert.equal(unknown.memberCount,null)
 assert.equal(preferredInviteRoles(unknown),null)
});
test('Read-only invite path never calls WAHA join nor sends messages',()=>{
 const source=readFileSync(new URL('../app/api/integrations/whatsapp/audit-groups/route.ts',import.meta.url),'utf8')
 assert.match(source,/groups\/join-info\?code=/)
 assert.doesNotMatch(source,/method:\s*['"]POST['"]|\/groups\/join['"]|sendImage|sendText/)
 assert.match(source,/process\.env\.GH_WA_AUDIT_PENDING_INVITE_CODES/)
});
