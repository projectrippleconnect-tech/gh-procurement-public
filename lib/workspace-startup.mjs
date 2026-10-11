// Bound startup without allowing a late network result to apply stale access.
export function withStartupDeadline(work,ms=15000){
 let timer
 return Promise.race([
  Promise.resolve(work),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The workspace is taking too long to respond. Check your connection and try again.')),ms)})
 ]).finally(()=>clearTimeout(timer))
}
