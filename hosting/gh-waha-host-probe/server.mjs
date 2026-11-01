// Zero-credential host probe. Does not contain WAHA, supplier data or a messaging API.
import {createServer} from 'node:http'
import {randomUUID, timingSafeEqual} from 'node:crypto'
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {pathToFileURL} from 'node:url'
import {resolve} from 'node:path'

export function initializeStorage(dir='/data'){
 try {
  mkdirSync(dir,{recursive:true})
  const file=join(dir,'gh-host-probe-marker')
  let marker
  try{marker=readFileSync(file,'utf8').trim()}catch{}
  if(!/^[0-9a-f-]{36}$/i.test(marker||'')){marker=randomUUID();writeFileSync(file,marker,{flag:'wx'});}
  return {storage:'writable',marker}
 }catch{return {storage:'unavailable',marker:null}}
}

const secureEqual=(a,b)=>{
 const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''))
 return x.length>0&&x.length===y.length&&timingSafeEqual(x,y)
}

export function createProbe({storage=initializeStorage(),key=process.env.GH_HOST_PROBE_KEY}={}){
 const bootId=randomUUID()
 const server=createServer((req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  const path=new URL(req.url||'/', 'http://localhost').pathname
  if(req.method==='GET'&&path==='/health'){
   res.statusCode=200
   return res.end(JSON.stringify({ok:true,app:'GH-host-probe',bootId,storage:storage.storage,marker:storage.marker}))
  }
  if(req.method==='POST'&&path==='/api/probe'){
   if(!key){res.statusCode=503;return res.end(JSON.stringify({ok:false,reason:'probe_key_not_configured'}))}
   if(!secureEqual(req.headers['x-probe-key'],key)){res.statusCode=401;return res.end(JSON.stringify({ok:false,reason:'unauthorized'}))}
   res.statusCode=200
   return res.end(JSON.stringify({ok:true,request:'authenticated'}))
  }
  res.statusCode=404;return res.end(JSON.stringify({ok:false,reason:'not_found'}))
 })
 return {server,bootId}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const port=Number(process.env.PORT||3000)
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT')
 const {server}=createProbe()
 server.listen(port,'0.0.0.0',()=>console.log('GH host probe listening (no credentials or WhatsApp sessions)'))
}
