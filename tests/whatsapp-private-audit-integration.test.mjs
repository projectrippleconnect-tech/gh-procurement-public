import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('both manual and both company automated supplier WhatsApp gateways include staff copies',()=>{
 const paths=['app/api/integrations/whatsapp/rfq/route.ts','app/api/integrations/whatsapp/po/route.ts','app/api/company-items/rfqs/route.ts','app/api/company-items/orders/route.ts']
 for(const path of paths){
  const content=read(path)
  assert.match(content,/mirrorStaffGroupCopy\(/,path)
  assert.match(content,/privateGroupCaption\(/,path)
  assert.ok(content.indexOf('finish')<content.lastIndexOf('mirrorStaffGroupCopy('),'Staff audit must be attempted only after supplier dispatch finalization: '+path)
 }
});
test('separate staff archive is disabled by default and has database one-attempt source/page constraint',()=>{
 const source=read('lib/whatsapp-private-audit.mjs')
 assert.match(source,/GH_WA_AUDIT_ENABLED!=='true'/)
 assert.match(source,/inspectPrivateGroup\(/)
 assert.match(source,/proc_whatsapp_claim_private_group_copy/)
 assert.match(source,/proc_whatsapp_finish_private_group_copy/)
 const sql=read('supabase/migrations/20261017223000_private_whatsapp_audit_group.sql')
 assert.match(sql,/unique\(source_kind,source_id,page_number\)/i)
 assert.match(sql,/create policy proc_private_group_copies_staff_view/i)
 assert.match(sql,/private\.proc_assert_access\(\)/)
 assert.match(sql,/status='accepted'/)
 assert.match(sql,/status='sending'/)
});
