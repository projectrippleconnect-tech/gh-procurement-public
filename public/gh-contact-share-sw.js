// Retirement worker for previously installed contact-share versions.
// No fetch interception, offline cache or background contact collection.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of ['gh-procurement-contact-shares-v1','gh-procurement-contact-shares-v2'])await caches.delete(name);
 await self.registration.unregister();
})()));
