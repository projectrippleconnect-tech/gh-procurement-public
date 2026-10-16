// Disposable PostgreSQL only. Exercise two genuinely concurrent stock submissions.
import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
const database=process.argv[2]
assert.match(database||'',/^isolated_[a-z_]+$/,'Use an isolated test database')
const args=['-X','-h','127.0.0.1','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-Atc']
const read=sql=>execFileSync('psql',[...args,sql],{encoding:'utf8'}).trim()
const started=read('select clock_timestamp()')
assert.match(started,/^\d{4}-\d\d-\d\d /)
const stats=()=>JSON.parse(read("select json_build_object('counts',(select count(*) from proc_stock_counts),'orders',(select count(*) from proc_purchase_orders),'queued',(select count(*) from proc_company_dispatch_queue))"))
const before=stats()
const company='00000000-0000-4000-8000-000000000101'
const body='[{"company_list_item_id":"00000000-0000-4000-8000-000000000401","current_stock":1}]'
const submit=`select public.proc_submit_company_list_check_v3('${company}','${body}',gen_random_uuid(),NULL,'${started}'::timestamptz)`
const auth="select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);"
function launch(sql,onOutput=()=>{}){
 const process=spawn('psql',[...args,sql],{timeout:30000})
 let out='',err=''
 process.stdout.on('data',b=>{out+=b;onOutput(out)})
 process.stderr.on('data',b=>{err+=b})
 return new Promise((resolve,reject)=>{process.on('error',reject);process.on('close',code=>resolve({code,out,err}))})
}
let announceLocked
const locked=new Promise(r=>{announceLocked=r})
const first=launch(`begin;${auth} select id from proc_companies where id='${company}' for update;select 'LOCKED';select pg_sleep(1);${submit};commit;`,out=>{if(out.includes('LOCKED'))announceLocked()})
await Promise.race([locked,first.then(r=>{if(r.code!==0)throw Error(r.err)})])
const second=launch(`begin;${auth}${submit};commit;`)
const [one,two]=await Promise.all([first,second])
assert.equal(one.code,0,one.err)
assert.notEqual(two.code,0,'Overlapping older count must be rejected after the first changes stock')
assert.match(two.err,/Stock changed after counting began/)
const after=stats()
assert.equal(after.counts,before.counts+1,'Only one overlapping count may commit')
assert.equal(after.orders,before.orders,'Concurrent counts created an extra PO')
assert.equal(after.queued,before.queued,'Concurrent counts queued another supplier message')
console.log('PASS concurrent different-token recounts serialize, reject stale stock and create no extra PO/message')
