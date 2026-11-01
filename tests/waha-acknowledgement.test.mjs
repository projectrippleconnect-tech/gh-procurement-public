import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {extractWahaMessageId} from '../lib/waha-rfq.js'

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('WAHA acknowledgements require a real message identifier',()=>{
 assert.equal(extractWahaMessageId({id:'msg-123'}),'msg-123')
 assert.equal(extractWahaMessageId({key:{id:'msg-456'}}),'msg-456')
 assert.equal(extractWahaMessageId({}),null)
 assert.equal(extractWahaMessageId({id:{}}),null)
})

test('manual RFQ and PO do not mistake a successful HTTP response for a confirmed gateway message',()=>{
 for(const kind of ['rfq','po']){
  const content=read('app/api/integrations/whatsapp/'+kind+'/route.ts')
  assert.match(content,/status=messageId\?'accepted':'unknown'/,kind)
  assert.match(content,/if\(!messageId\)lastError='Gateway returned HTTP success without a message ID/,kind)
  assert.match(content,/if\(status!=='accepted'\)return error\(/,kind)
  assert.ok(content.indexOf('proc_whatsapp_claim_')<content.indexOf("+'/api/sendImage'"),kind+' must claim before sending')
  assert.ok(content.indexOf('finish_')<content.lastIndexOf('mirrorStaffGroupCopy('),kind+' must finalize before audit copy')
 }
})

test('company RFQ stops a multi-page sequence and records unknown when any page has no message ID',()=>{
 const content=read('app/api/company-items/rfqs/route.ts')
 assert.match(content,/if\(!messageId\)\{status='unknown';lastError='Gateway returned HTTP success without a message ID.*;break\}/)
 assert.match(content,/if\(i===images.length-1\)status='accepted'/)
 assert.match(content,/if\(status==='accepted'&&!finishError\)/)
})

test('company PO checks every image page before accepted or attached documents',()=>{
 const content=read('app/api/company-items/orders/route.ts')
 assert.match(content,/messageId=extractWahaMessageId\(await response\.json\(\)\.catch\(\(\)=>\(\{\}\)\)\)/)
 assert.match(content,/if\(!messageId\)\{lastError='Gateway returned HTTP success without a message ID.*;break\}/)
 assert.match(content,/status=response\.ok\?\(lastError\?'unknown':'accepted'\)/)
 assert.match(content,/if\(status==='accepted'\)\{/)
 assert.ok(content.indexOf("status=response.ok?")<content.indexOf("for(const attachment of job.attachments||[])"))
 assert.match(content,/if\(status==='accepted'&&!finishError&&privateGroupConfig/)
})
