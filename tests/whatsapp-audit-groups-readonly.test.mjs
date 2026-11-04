import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('WhatsApp group check authenticates an active admin and never sends or joins',()=>{
 const api=file('app/api/integrations/whatsapp/audit-groups/route.ts')
 assert.match(api,/auth\.getUser\(token\)/)
 assert.match(api,/profile\?\.role!=='admin'/)
 assert.match(api,/profile\.active/)
 assert.match(api,/wahaGatewayConfig/)
 assert.match(api,/\/groups\?limit=50/)
 assert.match(api,/\/participants\/v2/)
 assert.doesNotMatch(api,/sendImage|sendText|\/groups\/join(?!-info)|\/participants\/add|export async function POST/)
});
test('Company Setup offers a manual, read-only group check rather than auto enabling copies',()=>{
 const ui=file('components/whatsapp-audit-groups.jsx')
 const company=file('components/modules-company.jsx')
 assert.match(ui,/Check my WhatsApp groups/)
 assert.match(ui,/supabase\.auth\.getSession\(\)/)
 assert.match(ui,/\/api\/integrations\/whatsapp\/audit-groups/)
 assert.match(ui,/No messages were sent by this check/)
 assert.match(company,/WhatsAppAuditGroups/)
 assert.doesNotMatch(ui,/method:['"]POST['"]|GH_WA_AUDIT_ENABLED.*true/)
});


test('Only exact configured RFQ and PO group IDs are accepted; read-only owner verification handles linked IDs',()=>{
 const api=file('app/api/integrations/whatsapp/audit-groups/route.ts')
 const ui=file('components/whatsapp-audit-groups.jsx')
 assert.match(api,/GH_WA_AUDIT_RFQ_GROUP_ID/)
 assert.match(api,/GH_WA_AUDIT_PO_GROUP_ID/)
 assert.match(api,/exactTarget\(/)
 assert.match(api,/resolveOwnerMemberAliases\(/)
 assert.match(api,/auditDatabaseReady/)
 assert.match(ui,/Configured WhatsApp destinations/)
 assert.match(ui,/Still unverified:/)
});
