import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const docker=readFileSync(new URL('../deploy/waha-hostless/Dockerfile',import.meta.url),'utf8')
const infra=readFileSync(new URL('../deploy/waha-hostless/hostless.yaml',import.meta.url),'utf8')

test('WAHA explicitly listens on Hostless public interface and port',()=>{
 assert.match(docker,/WHATSAPP_API_HOSTNAME=0\.0\.0\.0/)
 assert.match(docker,/WHATSAPP_API_PORT=3000/)
 assert.match(docker,/WHATSAPP_DEFAULT_ENGINE=GOWS/)
 assert.match(docker,/EXPOSE 3000/)
})

test('WAHA restarts only default without losing stored PostgreSQL sessions',()=>{
 assert.match(docker,/WHATSAPP_RESTART_ALL_SESSIONS=False/)
 assert.match(docker,/WHATSAPP_START_SESSION=default/)
 assert.doesNotMatch(docker,/WHATSAPP_RESTART_ALL_SESSIONS=True/)
 assert.doesNotMatch(docker,/WHATSAPP_SESSIONS_POSTGRESQL_URL=/)
})

test('Existing free allocation and deployment shape stay unchanged',()=>{
 assert.match(infra,/min_replicas:\s*1/)
 assert.match(infra,/max_replicas:\s*1/)
 assert.match(infra,/max_cpu:\s*0\.2/)
 assert.match(infra,/max_memory:\s*384/)
})
