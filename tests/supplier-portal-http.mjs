import {spawn} from 'node:child_process'
import assert from 'node:assert/strict'
const port=3101,base='http://127.0.0.1:'+port
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p',String(port)],{stdio:['ignore','pipe','pipe'],env:{...process.env,GH_PORTAL_PROCESSING_ENABLED:'false',GH_PORTAL_DISPATCH_ENABLED:'false'}})
let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b)
try{
 for(let i=0;i<100;i++){try{if((await fetch(base+'/supplier/quote')).ok)break}catch{}if(server.exitCode!==null)throw Error(output);await new Promise(r=>setTimeout(r,200))}
 for(const route of ['/supplier/quote','/supplier-links']){const r=await fetch(base+route);assert.equal(r.status,200);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('cache-control'),/no-store/);assert.ok((await r.text()).includes('General Hardware')||(await fetch(base+route).then(r=>r.text())).includes('GENERAL HARDWARE'))}
 const unauthorized=await fetch(base+'/api/supplier-portal/worker',{method:'POST'});assert.equal(unauthorized.status,401)
 console.log('PASS production HTTP smoke: supplier/staff pages, privacy headers, worker authorization; automation disabled')
}finally{server.kill('SIGTERM')}
