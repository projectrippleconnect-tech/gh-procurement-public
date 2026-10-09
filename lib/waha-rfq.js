// Server-side WAHA request helpers. Never import this module into client components.
export const normalizeSupplierChatId=(phone)=>{
 let digits=String(phone??'').replace(/\D/g,'')
 if(digits.startsWith('00'))digits=digits.slice(2)
 if(digits.startsWith('0'))digits='94'+digits.slice(1)
 else if(/^7\d{8}$/.test(digits))digits='94'+digits
 if(!/^\d{8,15}$/.test(digits))throw new Error('Supplier WhatsApp number is invalid.')
 return digits+'@c.us'
}
export const verifyPng=(base64)=>{
 if(typeof base64!=='string'||base64.length<32||base64.length>6_000_000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error('RFQ PNG is missing or too large (max approximately 4 MB).')
 const buf=Buffer.from(base64,'base64')
 if(buf.length<24||buf.length>4_500_000||buf.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('A valid PNG image is required.')
 const w=buf.readUInt32BE(16),h=buf.readUInt32BE(20)
 if(w<200||w>5000||h<200||h>20000)throw new Error('RFQ PNG dimensions are not supported.')
 return buf
}
export const wahaImagePayload=({session='default',phone,filename,base64,caption})=>({
 session,
 chatId:normalizeSupplierChatId(phone),
 file:{mimetype:'image/png',filename:String(filename||'RFQ.png').replace(/[^a-zA-Z0-9._-]/g,'-').slice(0,100),data:base64},
 caption:String(caption??'').slice(0,2000)
})
export const extractWahaMessageId=data=>{
 const id=data?.id?._serialized||data?.id||data?.key?.id||null
 return typeof id==='string'?id.slice(0,200):null
}
