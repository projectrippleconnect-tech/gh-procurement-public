/* GH Procurement PWA Android Share Target.
 * Receive only a contact deliberately shared with this installed website.
 * Keep it in this device's Cache API until the landing page retrieves it.
 */
const CACHE='gh-procurement-contact-shares-v1';
const PREFIX='/_gh_private_shared_contact/';
const LIMIT=5*1024*1024;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||url.pathname!=='/share/contact/receive'||event.request.method!=='POST')return;
 event.respondWith((async()=>{
  try{
   const form=await event.request.formData();
   const attachments=[];
   for(const [,v] of form.entries()){
    if(typeof v==='object'&&typeof v.arrayBuffer==='function'&&
       (String(v.name||'').toLowerCase().endsWith('.vcf')||/vcard|x-vcard|directory/i.test(v.type||''))){
      if(v.size>LIMIT)return Response.redirect('/share/contact?error=too-large',303);
      attachments.push(await v.text());
      if(attachments.length>=2)break;
    }
   }
   const payload={
    title:String(form.get('title')||'').slice(0,200),
    text:String(form.get('text')||'').slice(0,20000),
    cards:attachments,
    createdAt:Date.now()
   };
   if(!payload.cards.length&&!payload.title&&!payload.text)
    return Response.redirect('/share/contact?error=empty',303);
   const id=self.crypto.randomUUID().replaceAll('-','');
   const cache=await caches.open(CACHE);
   const entries=await cache.keys();
   for(const key of entries){
    const previous=await cache.match(key);
    const earlier=previous&&await previous.json().catch(()=>null);
    if(!earlier||Date.now()-earlier.createdAt>900000)await cache.delete(key);
   }
   await cache.put(new Request(new URL(PREFIX+id,self.location.origin)),new Response(JSON.stringify(payload),{
    headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
   }));
   return Response.redirect('/share/contact?share='+id,303);
  }catch(error){return Response.redirect('/share/contact?error=unavailable',303)}
 })());
});
