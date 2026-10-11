// Bound operations whose workers may never reply after an interrupted download.
export async function withOperationDeadline(work,{milliseconds=45000,message='This operation took too long. Please try again.',onLateResult}={}){
 let timer,timedOut=false
 const result=Promise.resolve(work).then(value=>{
  if(timedOut){onLateResult?.(value);return undefined}
  return value
 })
 try{return await Promise.race([result,new Promise((_,reject)=>{
  timer=setTimeout(()=>{timedOut=true;reject(new Error(message))},milliseconds)
 })])}finally{clearTimeout(timer)}
}
