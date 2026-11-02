import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const docker=readFileSync(new URL('../deploy/waha-hostless/Dockerfile',import.meta.url),'utf8')
const infra=readFileSync(new URL('../deploy/waha-hostless/hostless.yaml',import.meta.url),'utf8')
const root=readFileSync(new URL('../hostless.yaml',import.meta.url),'utf8')
const normalize=text=>text.split('\n').filter(line=>!/^\s*#/.test(line)).join('\n').trim()

test('WAHA Docker builds only the approved GOWS gateway, not the frontend',()=>{
 assert.match(docker,/FROM devlikeapro\/waha:gows/)
 assert.match(docker,/WHATSAPP_DEFAULT_ENGINE=GOWS/)
 assert.match(docker,/EXPOSE 3000/)
 assert.doesNotMatch(docker,/COPY.*gh-procurement/)
})

test('WAHA starts the existing default session without logging out or restarting other sessions',()=>{
 assert.match(docker,/WHATSAPP_RESTART_ALL_SESSIONS=False/)
 assert.match(docker,/WHATSAPP_START_SESSION=default/)
 assert.doesNotMatch(docker,/WHATSAPP_RESTART_ALL_SESSIONS=True/)
 assert.doesNotMatch(docker,/WHATSAPP_SESSIONS_POSTGRESQL_URL=/)
})

test('Default Hostless root file explicitly points to WAHA monorepo Dockerfile',()=>{
 assert.match(root,/working_directory:\s*"\/"\s*$/m)
 assert.match(root,/build_context_directory:\s*"\/"\s*$/m)
 assert.match(root,/^dockerfile_path:\s*"deploy\/waha-hostless\/Dockerfile"\s*$/m)
 assert.match(root,/^build:\s*\n\s*system:\s*docker/m)
})

test('Root and optional subdirectory Hostless files keep identical safe settings',()=>{
 assert.equal(normalize(root),normalize(infra))
 for(const c of [root,infra]){
  assert.match(c,/min_replicas:\s*1/)
  assert.match(c,/max_replicas:\s*1/)
  assert.match(c,/max_cpu:\s*0\.2/)
  assert.match(c,/max_memory:\s*384/)
  assert.doesNotMatch(c,/WAHA_API_KEY|POSTGRESQL_URL|GH_AUTO_DISPATCH_ENABLED/)
 }
})
