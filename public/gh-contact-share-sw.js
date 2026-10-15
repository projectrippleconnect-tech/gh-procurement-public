// Pass normal app traffic through unchanged. Intercept only explicit contact shares.
const CONTACT_CACHE='gh-procurement-contact-shares-v2';
const CONTACT_PREFIX='/_gh_private_shared_contact/';
const CONTACT_TTL=5*60*1000;
const CONTACT_LIMIT=2*1024*1024;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||url.pathname!=='/share/contact/receive'||event.request.method!=='POST')return;
 event.respondWith(receiveContact(event.request));
});
async function receiveContact(request){
 const redirect=query=>Response.redirect(new URL('/share/contact'+query,self.location.origin).href,303);
 try{
  const form=await request.formData(),cards=[];
  let bytes=0;
  for(const value of form.getAll('contact')){
   if(typeof value!=='object'||typeof value.text!=='function')continue;
   if(!/\.vcf$/i.test(value.name||'')&&!/^(text\/(x-)?vcard|text\/directory)$/i.test(value.type||''))continue;
   bytes+=value.size;
   if(bytes>CONTACT_LIMIT)return redirect('?error=too-large');
   if(cards.length>=2)return redirect('?error=too-many');
   cards.push(await value.text());
  }
  const payload={title:String(form.get('title')||'').slice(0,200),text:String(form.get('text')||'').slice(0,20000),cards,createdAt:Date.now()};
  if(!cards.length&&!payload.text)return redirect('?error=empty');
  const cache=await caches.open(CONTACT_CACHE),keys=await cache.keys();
  for(const key of keys){
   const stored=await cache.match(key),data=stored&&await stored.json().catch(()=>null);
   if(!data||!Number.isFinite(data.createdAt)||Date.now()-data.createdAt>CONTACT_TTL)await cache.delete(key);
  }
  const retained=await cache.keys();
  for(const key of retained.slice(0,Math.max(0,retained.length-4)))await cache.delete(key);
  const id=self.crypto.randomUUID().replaceAll('-','');
  await cache.put(new Request(new URL(CONTACT_PREFIX+id,self.location.origin)),new Response(JSON.stringify(payload),{headers:{'Content-Type':'application/json'}}));
  return redirect('?share='+id);
 }catch{return redirect('?error=unavailable')}
}
