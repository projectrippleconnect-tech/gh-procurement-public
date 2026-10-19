// Static application shell only. Never cache API, Supabase data, auth responses or RSC payloads.
const CACHE='gh-procurement-shell-20261019-v1'
const PREFIX='gh-procurement-shell-'
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/manifest.webmanifest')).then(()=>self.skipWaiting()))
})
self.addEventListener('activate',event=>{
 event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
 ]))
})
self.addEventListener('fetch',event=>{
 const request=event.request
 if(request.method!=='GET'||new URL(request.url).origin!==self.location.origin)return
 const url=new URL(request.url)
 if(url.pathname.startsWith('/api/')||url.searchParams.has('_rsc')||request.headers.has('RSC'))return
 if(url.pathname.startsWith('/_next/static/')){
  event.respondWith(caches.open(CACHE).then(async cache=>{
   const cached=await cache.match(request)
   if(cached)return cached
   const response=await fetch(request)
   if(response.ok)await cache.put(request,response.clone())
   return response
  }))
  return
 }
 if(request.mode==='navigate'&&url.pathname==='/'){
  event.respondWith((async()=>{
   try{
    const response=await fetch(request)
    if(response.ok)await (await caches.open(CACHE)).put('/',response.clone())
    return response
   }catch{
    return (await caches.match('/'))||new Response('GH Procurement needs to be opened online once before offline access is available.',{status:503,headers:{'Content-Type':'text/plain;charset=UTF-8'}})
   }
  })())
 }
})
