import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import ts from 'typescript'

const read=path=>readFileSync(path,'utf8')
const migration=read('supabase/migrations/20261021212000_supplier_quote_portal_intake.sql')
const portal=read('app/supplier/quote/page.jsx')
const staff=read('app/supplier-links/page.jsx')

test('supplier pages compile as valid JSX syntax',()=>{
 for(const file of ['app/supplier/quote/page.jsx','app/supplier-links/page.jsx']){
  const s=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,ts.ScriptKind.JSX)
  assert.deepEqual(s.parseDiagnostics.map(x=>ts.flattenDiagnosticMessageText(x.messageText,' ')),[],file)
 }
})
test('portal shares only token hashes with the database',()=>{
 assert.match(staff,/crypto\.getRandomValues\(new Uint8Array\(32\)\)/)
 assert.match(staff,/crypto\.subtle\.digest\('SHA-256'/)
 assert.match(staff,/p_token_hash:hash/)
 assert.match(migration,/token_hash text not null unique/)
 assert.match(migration,/extensions\.digest\(p_token,'sha256'\)/)
 assert.match(read('next.config.ts'),/Referrer-Policy', value: 'no-referrer'/)
})
test('anonymous clients cannot directly write official quotes or purchase orders',()=>{
 assert.match(migration,/revoke all on public\.proc_supplier_portal_links from public,anon,authenticated/)
 assert.match(migration,/grant execute on function public\.proc_portal_submit_v1\(text,jsonb,integer,boolean\) to anon,authenticated/)
 assert.doesNotMatch(migration,/grant (?:insert|update|delete) on public\.proc_(?:quotes|quote_lines|purchase_orders) to anon/)
 assert.match(migration,/public\.proc_save_quote_guarded_v1/)
 assert.match(migration,/auth\.uid\(\) is null or not private\.proc_has_permission\('procurement\.rfq\.manage'\)/)
})
test('six-hour window, quote revisions, images and availability are validated in the database',()=>{
 assert.match(migration,/make_interval\(hours=>p_hours\)/)
 assert.match(migration,/clock_timestamp\(\)>=access\.closes_at/)
 assert.match(migration,/p_expected_revision is distinct from access\.revision/)
 assert.match(migration,/in_stock','no_stock','skip'/)
 assert.match(migration,/Maximum four variations per item/)
 assert.match(migration,/octet_length\(p_response::text\)>1500000/)
 assert.match(migration,/Supplier revised the quotation: refresh before importing/)
 assert.match(migration,/Supplier prices already imported/)
})
test('supplier portal changes do not initiate unattended purchase orders',()=>{
 assert.doesNotMatch(migration,/insert into public\.proc_purchase_orders/i)
 assert.doesNotMatch(portal,/WAHA|sendWhatsApp|autoPurchase/)
 assert.match(staff,/Every round requires approved limits/)
 assert.match(read('components/rfq-workspace.jsx'),/Supplier Links ↗/)
})
