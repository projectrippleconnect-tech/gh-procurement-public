import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const orders=readFileSync(new URL('../components/modules-documents.jsx',import.meta.url),'utf8')
const share=readFileSync(new URL('../lib/po-share.js',import.meta.url),'utf8')

test('primary approved PO sharing does not depend on the disconnected gateway',()=>{
 const primary=orders.match(/aria-label="Manual supplier WhatsApp PO sharing">([\s\S]*?)<\/section>/)?.[1]
 assert.ok(primary,'Approved PO primary actions exist')
 assert.match(primary,/aria-label="Share PO PNG \+ Caption"[^>]*onClick=\{\(\)=>exportPo\('share'\)\}/)
 assert.doesNotMatch(primary,/sendBlock|gateway/)
 assert.match(orders,/onClick=\{\(\)=>exportPo\('share'\)\}/)
 assert.doesNotMatch(orders,/onClick=\{sendPoImage\}>Send PO image<\/button>/)
 assert.match(primary,/onClick=\{\(\)=>whatsapp\(true\)\}/)
})

test('gateway sending remains a separate, protected, optional action',()=>{
 assert.match(orders,/Automatic WhatsApp gateway · optional/)
 assert.match(orders,/disabled=\{Boolean\(sendBlock\)\|\|busy\|\|shareBusy\}/)
 assert.match(orders,/onClick=\{sendPoImage\}/)
 assert.match(orders,/Confirm Sent<\/button>/)
})

test('manual share includes file and caption, and preserves both when native share is unavailable',()=>{
 assert.match(share,/navigator\.share\(\{title:'Purchase Order',text:caption,files:\[file\]\}\)/)
 assert.match(share,/downloadBlob\(out\.blob,out\.filename\)/)
 assert.match(share,/navigator\.clipboard\.writeText\(caption\)/)
 assert.match(share,/captionCopied/)
 assert.match(orders,/Copy PO Caption/)
 assert.match(orders,/Open Supplier Chat/)
})
