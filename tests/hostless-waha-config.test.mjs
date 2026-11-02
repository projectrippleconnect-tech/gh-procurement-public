import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const dockerfile=readFileSync(new URL('../deploy/waha-hostless/Dockerfile',import.meta.url),'utf8')
const hostlessfile=readFileSync(new URL('../deploy/waha-hostless/hostless.yaml',import.meta.url),'utf8')

test('WAHA recovery starts only the explicitly authorized default session',()=>{
 assert.match(dockerfile,/WHATSAPP_DEFAULT_ENGINE=GOWS/)
 assert.match(dockerfile,/WHATSAPP_RESTART_ALL_SESSIONS=False/)
 assert.match(dockerfile,/WHATSAPP_START_SESSION=default/)
 assert.doesNotMatch(dockerfile,/WHATSAPP_RESTART_ALL_SESSIONS=True/)
 assert.match(dockerfile,/WAHA_DASHBOARD_ENABLED=false/)
 assert.match(dockerfile,/WHATSAPP_SWAGGER_ENABLED=false/)
})

test('Hostless recovery preserves bounded one-replica design',()=>{
 assert.match(hostlessfile,/min_replicas:\s*1/)
 assert.match(hostlessfile,/max_replicas:\s*1/)
 assert.match(hostlessfile,/max_cpu:\s*0\.2/)
 assert.match(hostlessfile,/max_memory:\s*512/)
 assert.doesNotMatch(hostlessfile,/\b(min|max)_replicas:\s*[2-9]/)
})

test('Gateway secrets are supplied only at runtime',()=>{
 assert.doesNotMatch(dockerfile,/\b(?:WAHA_API_KEY|WHATSAPP_SESSIONS_POSTGRESQL_URL)=/)
 assert.doesNotMatch(hostlessfile,/\b(?:WAHA_API_KEY|WHATSAPP_SESSIONS_POSTGRESQL_URL):/)
})
