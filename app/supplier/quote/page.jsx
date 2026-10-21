'use client'
import {useCallback,useEffect,useMemo,useState} from 'react'
import {supabase} from '@/lib/supabase'

const panel={background:'#132136',color:'#f5f7fb',border:'1px solid #33465f',borderRadius:16,padding:16,marginBottom:12}
const field={width:'100%',background:'#0b1627',color:'#f5f7fb',border:'1px solid #4a5d75',borderRadius:9,padding:'12px',fontSize:16}
const button={background:'#fbbf24',color:'#141414',fontSize:16,fontWeight:700,border:0,borderRadius:11,padding:'13px 18px',cursor:'pointer'}
const emptyItem=id=>({id,status:'skip',price:'',quantity:'',notes:'',image:'',variations:[]})
const errMessage=e=>e?.message||String(e)
async function shrinkImage(file){
 if(!file.type.startsWith('image/'))throw new Error('Choose a photo.')
 if(file.size>8_000_000)throw new Error('Photo must be under 8 MB.')
 const bitmap=await createImageBitmap(file)
 const scale=Math.min(1,640/Math.max(bitmap.width,bitmap.height))
 const canvas=document.createElement('canvas')
 canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale)
 const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height)
 bitmap.close?.()
 const data=canvas.toDataURL('image/jpeg',0.65)
 if(data.length>210000)throw new Error('Image is too large after compression. Choose a smaller photo.')
 return data
}
function Remaining({closesAt}){
 const [now,setNow]=useState(Date.now())
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
 const seconds=Math.max(0,Math.floor((Date.parse(closesAt)-now)/1000))
 return <span>{seconds?Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m '+seconds%60+'s':'Closed'}</span>
}
export default function SupplierQuotePortal(){
 const [token,setToken]=useState('')
 const [quote,setQuote]=useState(null)
 const [lines,setLines]=useState([])
 const [error,setError]=useState('')
 const [busy,setBusy]=useState(false)
 const [agreed,setAgreed]=useState(false)
 const [query,setQuery]=useState('')
 const [revision,setRevision]=useState(0)
 const load=useCallback(async value=>{
  setError('')
  const {data,error}=await supabase.rpc('proc_portal_read_v1',{p_token:value})
  if(error)throw error
  setQuote(data)
  setRevision(data.revision)
  const previous=new Map((data.response||[]).map(x=>[x.id,x]))
  setLines((data.items||[]).map(x=>({...emptyItem(x.id),...previous.get(x.id)})))
 },[])
 useEffect(()=>{
  const value=new URLSearchParams(window.location.search).get('token')||''
  setToken(value)
  if(!value){setError('This quotation link is missing or invalid.');return}
  load(value).catch(e=>setError(errMessage(e)))
 },[load])
 const setItem=(id,changes)=>{setAgreed(false);setLines(rows=>rows.map(x=>x.id===id?{...x,...changes}:x))}
 const setVariation=(id,n,changes)=>{setAgreed(false);setLines(rows=>rows.map(row=>row.id===id?{...row,variations:row.variations.map((v,i)=>i===n?{...v,...changes}:v)}:row))}
 const imagesBusy=busy
 async function addImage(id,index,file){
  if(!file)return
  setBusy(true)
  try{
   const image=await shrinkImage(file)
   if(index===null)setItem(id,{image})
   else setVariation(id,index,{image})
  }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 async function submit(confirm){
  if(!quote||busy)return
  if(confirm&&!agreed){setError('Please confirm the quotation before submitting.');return}
  setBusy(true);setError('')
  try{
   const payload=lines.map(({id,status,price,quantity,notes,image,variations})=>({
    id,status,price:status==='in_stock'?price:null,quantity:status==='in_stock'?quantity:null,
    notes:String(notes||'').slice(0,500),image:image||null,
    variations:status==='in_stock'?variations.map(v=>({...v,image:v.image||null})):[]
   }))
   const {data,error}=await supabase.rpc('proc_portal_submit_v1',{
    p_token:token,p_response:payload,p_expected_revision:revision,p_confirm:confirm
   })
   if(error)throw error
   await load(token)
   setAgreed(false)
   window.scrollTo({top:0,behavior:'smooth'})
  }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const visible=useMemo(()=>quote?.items?.filter(x=>(x.description+' '+x.size+' '+x.item_code).toLowerCase().includes(query.trim().toLowerCase()))||[],[quote,query])
 const answered=lines.filter(x=>x.status!=='skip').length
 const editable=Boolean(quote?.can_edit)&&quote?.status!=='imported'
 return <main style={{background:'#0a1423',color:'#f5f7fb',minHeight:'100vh',padding:'16px 12px 120px',fontFamily:'system-ui, sans-serif'}}>
  <div style={{maxWidth:680,margin:'0 auto'}}>
   <header style={{marginBottom:20}}><small style={{letterSpacing:2,color:'#fbbf24'}}>GENERAL HARDWARE</small><h1 style={{margin:'5px 0'}}>Supplier Quotation</h1>
   <div style={{color:'#cad5e4'}}>{quote?.rfq_no||'Loading request…'} {quote?.supplier_name?' · '+quote.supplier_name:''}</div></header>
   {error&&<div role="alert" style={{...panel,borderColor:'#f87171',color:'#fecaca'}}>{error}</div>}
   {quote&&<>
    <div style={panel}>
     <div style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}><strong>{quote.status==='confirmed'?'Quotation confirmed':quote.status==='imported'?'Quotation received by GH':'Quotation in progress'}</strong><strong style={{color:'#fbbf24'}}><Remaining closesAt={quote.closes_at}/></strong></div>
     <p style={{color:'#cbd5e1',marginBottom:2}}>{answered}/{lines.length} availability responses · {new Date(quote.closes_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})} (Sri Lanka)</p>
     <p style={{color:'#cbd5e1',fontSize:13,marginBottom:0}}>You can edit prices and upload images before the deadline. GH sees your final confirmed response after staff import.</p>
    </div>
    <input aria-label="Search requested items" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search items or sizes…" style={{...field,marginBottom:12}}/>
    {visible.map(item=>{
     const row=lines.find(x=>x.id===item.id)||emptyItem(item.id)
     return <section key={item.id} style={panel}>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,marginBottom:8}}><strong>{item.description} {item.size||''}</strong><small style={{whiteSpace:'nowrap',color:'#cbd5e1'}}>Need {item.requested_qty} {item.uom}</small></div>
      <div style={{display:'flex',gap:15,flexWrap:'wrap',marginBottom:12}}>
       {['in_stock','no_stock'].map(status=><label key={status} style={{fontSize:14}}><input type="radio" name={'stock_'+item.id} disabled={!editable} checked={row.status===status} onChange={()=>setItem(item.id,{status})}/> {status==='in_stock'?'In stock':'No stock'}</label>)}
      </div>
      {row.status==='in_stock'&&<div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:9}}>
       <label>Unit price (Rs.)<input aria-label={'Price for '+item.description} type="number" min="0" step=".01" inputMode="decimal" style={field} disabled={!editable} value={row.price??''} onChange={e=>setItem(item.id,{price:e.target.value})}/></label>
       <label>Available qty<input aria-label={'Quantity for '+item.description} type="number" min="0" step="any" inputMode="decimal" style={field} disabled={!editable} value={row.quantity??''} onChange={e=>setItem(item.id,{quantity:e.target.value})}/></label>
       <label style={{gridColumn:'1 / -1'}}>Notes (optional)<input style={field} maxLength={500} disabled={!editable} value={row.notes||''} onChange={e=>setItem(item.id,{notes:e.target.value})} placeholder="Delivery time, colour, etc."/></label>
       <label style={{gridColumn:'1 / -1'}}>Photo (optional)
        <input type="file" accept="image/*" disabled={!editable||imagesBusy} onChange={e=>addImage(item.id,null,e.target.files?.[0])}/>
        {row.image&&<img alt="Quoted product" src={row.image} width={85} height={85} style={{objectFit:'cover',borderRadius:8,display:'block',marginTop:8}}/>}
       </label>
       <div style={{gridColumn:'1 / -1'}}>
        <strong>Alternative variations (optional)</strong>
        {(row.variations||[]).map((variation,index)=><div key={index} style={{border:'1px solid #34475e',padding:10,borderRadius:9,marginTop:10,display:'grid',gap:7}}>
         <input style={field} disabled={!editable} maxLength={140} placeholder="Variation / size / colour" aria-label="Variation description" value={variation.name||''} onChange={e=>setVariation(item.id,index,{name:e.target.value})}/>
         <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
          <input style={field} disabled={!editable} type="number" min="0" step=".01" inputMode="decimal" placeholder="Price" aria-label="Variation price" value={variation.price??''} onChange={e=>setVariation(item.id,index,{price:e.target.value})}/>
          <input style={field} disabled={!editable} type="number" min="0" step="any" inputMode="decimal" placeholder="Available qty" aria-label="Variation quantity" value={variation.quantity??''} onChange={e=>setVariation(item.id,index,{quantity:e.target.value})}/>
         </div>
         <input type="file" accept="image/*" aria-label="Variation photo" disabled={!editable||imagesBusy} onChange={e=>addImage(item.id,index,e.target.files?.[0])}/>
         {variation.image&&<img alt="Alternative variation" src={variation.image} width={85} height={85} style={{objectFit:'cover',borderRadius:8}}/>}
         {editable&&<button type="button" onClick={()=>setItem(item.id,{variations:row.variations.filter((_,i)=>i!==index)})} style={{...button,background:'#263850',color:'white'}}>Remove variation</button>}
        </div>)}
        {editable&&(row.variations||[]).length<4&&<button type="button" style={{...button,background:'#263850',color:'white',marginTop:9}} onClick={()=>setItem(item.id,{variations:[...(row.variations||[]),{name:'',price:'',quantity:'',image:''}]})}>+ Add variation</button>}
       </div>
      </div>}
     </section>
    })}
    {editable&&<div style={{...panel,position:'sticky',bottom:6,boxShadow:'0 -8px 20px #0a1423'}}>
      <label style={{display:'flex',alignItems:'start',gap:9,marginBottom:12}}><input type="checkbox" checked={agreed} onChange={e=>setAgreed(e.target.checked)}/> I confirm the prices, available quantities and item variations entered here are correct.</label>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
       <button type="button" disabled={busy} onClick={()=>submit(false)} style={{...button,background:'#334155',color:'white'}}>Save draft</button>
       <button type="button" disabled={busy||!agreed||answered!==lines.length} onClick={()=>submit(true)} style={button}>{busy?'Saving…':'Final confirm'}</button>
      </div>
     </div>}
    {!editable&&<div style={panel}>Editing is unavailable. Contact General Hardware if you need to revise or reopen this quotation.</div>}
   </>}
  </div>
 </main>
}