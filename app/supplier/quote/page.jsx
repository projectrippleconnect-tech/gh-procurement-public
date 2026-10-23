'use client'
import {useCallback,useEffect,useMemo,useState} from 'react'
import {supplierClient as supabase} from '@/lib/supplier-client'

const panel={background:'#132136',color:'#f5f7fb',border:'1px solid #33465f',borderRadius:16,padding:16,marginBottom:12}
const field={boxSizing:'border-box',minWidth:0,width:'100%',background:'#0b1627',color:'#f5f7fb',border:'1px solid #4a5d75',borderRadius:9,padding:'12px',fontSize:16}
const button={background:'#fbbf24',color:'#141414',fontSize:16,fontWeight:700,border:0,borderRadius:11,padding:'13px 18px',cursor:'pointer'}
const emptyItem=id=>({id,discount:'0',tax:'0',freight_unit:'0',moq:'0',multiple:'1',lead_days:'',valid_until:'',terms_confirmed:false,status:'skip',price:'',quantity:'',notes:'',image:'',variations:[]})
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
 const [notice,setNotice]=useState('')
 const [dirty,setDirty]=useState(false)
 const [clock,setClock]=useState(Date.now())
 const [offset,setOffset]=useState(0)
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer)},[])
 useEffect(()=>{const warn=e=>{if(dirty){e.preventDefault();e.returnValue=''}};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty])
 const [busy,setBusy]=useState(false)
 const [agreed,setAgreed]=useState(false)
 const [query,setQuery]=useState('')
 const [globalDelivery,setGlobalDelivery]=useState('')
 const [globalValidity,setGlobalValidity]=useState('')
 const [expanded,setExpanded]=useState({})
 const [revision,setRevision]=useState(0)
 const load=useCallback(async value=>{
  setError('')
  const {data,error}=await supabase.rpc('proc_portal_read_v1',{p_token:value})
  if(error)throw error
  setQuote(data)
  setOffset(Date.parse(data.server_now)-Date.now())
  setDirty(false)
  setRevision(data.revision)
  const previous=new Map((data.response||[]).map(x=>[x.id,x]))
  const previousTerms=(data.response||[]).find(x=>x.status==='in_stock')||(data.response||[])[0]
  setGlobalDelivery(String(previousTerms?.lead_days??''))
  setGlobalValidity(previousTerms?.valid_until||'')
  setExpanded({})
  setLines((data.items||[]).map(x=>({...emptyItem(x.id),uom:x.uom,...previous.get(x.id)})))
 },[])
 useEffect(()=>{
  const value=new URLSearchParams(window.location.hash.slice(1)).get('token')||new URLSearchParams(window.location.search).get('token')||sessionStorage.getItem('gh-supplier-token')||''
  if(value)sessionStorage.setItem('gh-supplier-token',value)
  setToken(value)
  if(value)window.history.replaceState({},'',window.location.pathname)
  if(!value){setError('This quotation link is missing or invalid.');return}
  load(value).catch(e=>setError(errMessage(e)))
 },[load])
 const setItem=(id,changes)=>{setAgreed(false);setNotice('');setDirty(true);setLines(rows=>rows.map(x=>x.id===id?{...x,...changes,...('terms_confirmed' in changes?{}:{terms_confirmed:false})}:x))}
 const setAllTerm=(key,value)=>{
  setAgreed(false);setNotice('');setDirty(true)
  if(key==='lead_days')setGlobalDelivery(value)
  if(key==='valid_until')setGlobalValidity(value)
  setLines(rows=>rows.map(row=>({...row,[key]:value,terms_confirmed:false})))
 }
 const showDetails=id=>setExpanded(prev=>({...prev,[id]:true}))
 const addVariation=(id,row)=>{
  if((row.variations||[]).length>=4)return
  setItem(id,{status:row.status==='skip'?'no_stock':row.status,variations:[...(row.variations||[]),{name:'',price:'',quantity:'',image:''}]})
  showDetails(id)
 }
 const setVariation=(id,n,changes)=>{setAgreed(false);setNotice('');setDirty(true);setLines(rows=>rows.map(row=>row.id===id?{...row,variations:row.variations.map((v,i)=>i===n?{...v,...changes}:v)}:row))}
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
  if(confirm){
   const missing=quote.items.find(item=>{
    const row=lines.find(x=>x.id===item.id)
    return !row||row.status==='skip'||row.status==='in_stock'&&(
     !Number.isFinite(Number(row.price))||Number(row.price)<=0||
     !Number.isFinite(Number(row.quantity))||Number(row.quantity)<=0||
     String(row.lead_days??'')===''||!row.valid_until
    )
   })
   if(missing){setError('Complete available quantity, rate, delivery days and quotation validity, or mark no stock: '+missing.description);return}
  }
  setBusy(true);setError('')
  try{
   const payload=lines.map(({id,status,price,quantity,notes,image,variations,discount,tax,freight_unit,moq,multiple,lead_days,valid_until,terms_confirmed,uom})=>({
    discount,tax,freight_unit,moq,multiple,lead_days,valid_until,terms_confirmed:confirm&&agreed&&status==='in_stock',uom,
    id,status,price:status==='in_stock'?price:null,quantity:status==='in_stock'?quantity:null,
    notes:String(notes||'').slice(0,500),image:image||null,
    variations:variations.map(v=>({...v,image:v.image||null}))
   }))
   const {data,error}=await supabase.rpc('proc_portal_submit_v1',{
    p_token:token,p_response:payload,p_expected_revision:revision,p_confirm:confirm
   })
   if(error)throw error
   setRevision(data.revision)
   setQuote(q=>({...q,status:data.status,revision:data.revision}))
   setDirty(false)
   setNotice(confirm?'Quotation confirmed. You can revise and confirm again before the deadline.':'Draft saved. It will be here when you reopen this link.')
   setAgreed(false)
   window.scrollTo({top:0,behavior:'smooth'})
  }catch(e){setError(errMessage(e))}finally{setBusy(false)}
 }
 const visible=useMemo(()=>quote?.items?.filter(x=>(x.description+' '+x.size+' '+x.item_code).toLowerCase().includes(query.trim().toLowerCase()))||[],[quote,query])
 const answered=lines.filter(x=>x.status!=='skip').length
 const editable=Boolean(quote?.can_edit)&&clock+offset<Date.parse(quote?.closes_at)
 const total=quote?.items?.reduce((sum,item)=>{
  const row=lines.find(x=>x.id===item.id)
  if(row?.status!=='in_stock'||!Number.isFinite(Number(row.price))||!Number.isFinite(Number(row.quantity))||Number(row.price)<=0||Number(row.quantity)<=0)return sum
  return sum+Math.min(Number(row.quantity),Number(item.requested_qty))*Number(row.price)
 },0)||0
 const money=n=>new Intl.NumberFormat('en-LK',{maximumFractionDigits:2,minimumFractionDigits:2}).format(n)
 return <main className="supplier-quote-portal sq-compact">
  <style>{'.sq-compact{background:#0a1423;color:#f5f7fb;min-height:100vh;padding:14px 10px 100px;font-family:system-ui,sans-serif}.sq-compact *{box-sizing:border-box;min-width:0}.sq-sheet{max-width:920px;margin:auto}.sq-compact input,.sq-compact button{font:inherit}.sq-box{background:#132136;border:1px solid #33465f;border-radius:12px;padding:11px;margin-bottom:11px}.sq-muted{color:#cbd5e1;font-size:12px}.sq-compact .sq-control{width:100%;max-width:100%;border:1px solid #64748b;border-radius:7px;padding:8px 6px;background:#0b1627;color:#fff;font-size:16px}.sq-compact .sq-rate{padding:8px 4px;text-align:right}.sq-table{border:1px solid #40536d;border-radius:11px;overflow:hidden;margin:9px 0;background:#122137}.sq-grid{display:grid;grid-template-columns:minmax(0,1fr) 50px 67px 79px;gap:4px;align-items:center}.sq-head{padding:8px 7px;background:#27394f;font-size:11px;font-weight:750;color:#e5e7eb}.sq-row{padding:9px 7px;border-top:1px solid #33465f}.sq-name{font-size:13px;font-weight:700;overflow-wrap:anywhere;line-height:1.3}.sq-uom{display:block;color:#cbd5e1;font-size:11px;font-weight:400;margin-top:3px}.sq-req{font-size:13px;text-align:right;font-weight:650}.sq-quote-item-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}.sq-compact .sq-link{display:inline;border:0;background:none;color:#93c5fd;text-decoration:underline;padding:2px 0;font-size:11px;cursor:pointer;text-align:left}.sq-compact .sq-link:disabled{opacity:.5}.sq-compact .sq-link:focus-visible{outline:2px solid #fbbf24;outline-offset:3px}.sq-compact .sq-rate-note{display:block;font-size:10px;color:#a9bcd3;text-align:right;margin-top:3px}.sq-compact .sq-options{grid-column:1/-1;border-top:1px dashed #3e536f;margin-top:7px;padding-top:9px}.sq-compact .sq-options label{display:block;font-size:12px}.sq-compact .sq-additional{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:8px}.sq-compact .sq-variation{padding:8px;border:1px solid #33465f;border-radius:7px;margin:8px 0}.sq-compact .sq-variation input{margin-top:4px}.sq-compact input[type=file]{width:100%;max-width:100%;font-size:12px}.sq-compact .sq-primary{background:#fbbf24;color:#141414;font-size:15px;font-weight:700;border:0;border-radius:9px;padding:11px;cursor:pointer}.sq-compact .sq-secondary{background:#334155;color:#fff;font-size:15px;font-weight:700;border:0;border-radius:9px;padding:11px;cursor:pointer}.sq-compact button:disabled,.sq-compact input:disabled{opacity:.55;cursor:not-allowed}.sq-compact .sq-footer{position:sticky;bottom:4px;box-shadow:0 -8px 24px #0a1423}.sq-compact img{max-width:100%;object-fit:cover}.sq-compact summary{cursor:pointer;font-weight:650;font-size:12px;padding:5px 0}@media(max-width:350px){.sq-compact{padding:8px 6px 100px}.sq-grid{grid-template-columns:minmax(0,1fr) 43px 63px 73px;gap:3px}.sq-name{font-size:12px}.sq-row,.sq-head{padding-left:5px;padding-right:5px}.sq-compact .sq-rate{padding:7px 2px}}'}</style>
  <div className="sq-sheet">
   <header style={{marginBottom:12}}><small style={{letterSpacing:1.5,color:'#fbbf24'}}>GENERAL HARDWARE</small><h1 style={{fontSize:22,margin:'3px 0'}}>Supplier Quotation</h1><div className="sq-muted">{quote?.rfq_no||'Loading request…'} {quote?.supplier_name?' · '+quote.supplier_name:''}</div></header>
   {error&&<div role="alert" className="sq-box" style={{borderColor:'#f87171',color:'#fecaca'}}>{error}</div>}
   {notice&&<div role="status" className="sq-box">{notice}</div>}
   {quote&&<>
    <div className="sq-box">
     <div style={{display:'flex',justifyContent:'space-between',gap:8}}><strong style={{fontSize:14}}>{dirty?'Unsaved changes':quote.status==='confirmed'?'Quotation confirmed':quote.status==='imported'?'Quotation received by GH':'Quotation in progress'}</strong><strong style={{color:'#fbbf24',whiteSpace:'nowrap',fontSize:13}}><Remaining closesAt={new Date(Date.parse(quote.closes_at)-offset).toISOString()}/></strong></div>
     <div className="sq-muted" style={{marginTop:4}}>{answered}/{lines.length} item responses · Closes {new Date(quote.closes_at).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})}</div>
     <div className="sq-muted" style={{marginTop:5}}>Enter your available quantity and rate per requested unit. Confirmed prices go into GH Prices; automatic PO allocation happens after the approved quotation round closes.</div>
    </div>
    <div className="sq-box">
     <div style={{display:'flex',gap:8,justifyContent:'space-between',alignItems:'center',marginBottom:8}}><strong style={{fontSize:13}}>Common delivery terms</strong><button type="button" className="sq-link" disabled={busy} onClick={()=>{if(!dirty||window.confirm('Reload and discard unsaved changes?'))load(token).catch(e=>setError(errMessage(e)))}}>Refresh</button></div>
     <div className="sq-additional" style={{marginTop:0}}>
      <label>Delivery days (all items)<input className="sq-control" aria-label="Delivery days (all items)" disabled={!editable||busy} inputMode="numeric" type="number" min="0" max="365" step="1" placeholder="e.g. 2" value={globalDelivery} onChange={e=>setAllTerm('lead_days',e.target.value)}/></label>
      <label>Valid through (all items)<input className="sq-control" aria-label="Valid through (all items)" disabled={!editable||busy} type="date" value={globalValidity} onChange={e=>setAllTerm('valid_until',e.target.value)}/></label>
     </div>
     <p className="sq-muted" style={{margin:'7px 0 0'}}>These apply to all items unless changed under an item's optional details. Rates are in LKR; enter discounts, taxes or freight only when applicable.</p>
    </div>
    <input className="sq-control" aria-label="Search requested items" style={{marginBottom:8}} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search item or size…"/>
    <div className="sq-table" role="table" aria-label="Supplier quotation bill">
     <div className="sq-grid sq-head" role="row"><span role="columnheader">Description</span><span role="columnheader" style={{textAlign:'right'}}>Req.</span><span role="columnheader" style={{textAlign:'right'}}>Avail.</span><span role="columnheader" style={{textAlign:'right'}}>Rate Rs.</span></div>
     {visible.map(item=>{
      const row=lines.find(x=>x.id===item.id)||emptyItem(item.id)
      const isOut=row.status==='no_stock'
      const extended=Boolean(expanded[item.id])
      const available=Number(row.quantity),rate=Number(row.price)
      const hasAmount=row.status==='in_stock'&&available>0&&rate>0&&Number.isFinite(available)&&Number.isFinite(rate)
      return <section className="sq-grid sq-row" role="row" key={item.id}>
       <div role="cell">
        <div className="sq-name">{item.description} {item.size||''}</div>
        <span className="sq-uom">{item.uom} {isOut?'· No stock':row.status==='skip'?'· Not answered':''}</span>
        <div className="sq-quote-item-actions">
         <button className="sq-link" disabled={!editable||busy} type="button" aria-label={(isOut?'Mark in stock for ':'No stock for ')+item.description} onClick={()=>setItem(item.id,{status:isOut?'in_stock':'no_stock'})}>{isOut?'In stock':'No stock'}</button>
         <button className="sq-link" disabled={!editable||busy||(row.variations||[]).length>=4} type="button" onClick={()=>addVariation(item.id,row)}>+ Variation</button>
         <button className="sq-link" type="button" onClick={()=>setExpanded(prev=>({...prev,[item.id]:!extended}))}>{(row.variations||[]).length||row.image?'Photo / details *':'Photo / details'}</button>
        </div>
       </div>
       <div role="cell" className="sq-req">{item.requested_qty}</div>
       <div role="cell"><input className="sq-control sq-rate" aria-label={'Quantity for '+item.description} type="number" min="0" step="any" inputMode="decimal" placeholder="Qty" disabled={!editable||busy||isOut} value={isOut?'':row.quantity??''} onChange={e=>setItem(item.id,{quantity:e.target.value,status:'in_stock'})}/></div>
       <div role="cell"><input className="sq-control sq-rate" aria-label={'Price for '+item.description} type="number" min="0" step=".01" inputMode="decimal" placeholder="Rate" disabled={!editable||busy||isOut} value={isOut?'':row.price??''} onChange={e=>setItem(item.id,{price:e.target.value,status:'in_stock'})}/>{hasAmount&&<span className="sq-rate-note">≈ {money(Math.min(available,Number(item.requested_qty))*rate)}</span>}</div>
       {extended&&<div className="sq-options">
        <div className="sq-muted">Optional attachments and alternatives for {item.description} {item.size||''}</div>
        {editable&&<label style={{marginTop:8}}>Item photo (optional)<input aria-label={'Photo for '+item.description} type="file" accept="image/*" disabled={imagesBusy} onChange={e=>addImage(item.id,null,e.target.files?.[0])}/></label>}
        {row.image&&<img alt="Quoted product" src={row.image} width={70} height={70} style={{marginTop:6,borderRadius:7}}/>}
        {(row.variations||[]).map((v,index)=><div className="sq-variation" key={index}>
         <input className="sq-control" aria-label="Variation description" placeholder="Alternative size / variation" maxLength={140} disabled={!editable||busy} value={v.name||''} onChange={e=>setVariation(item.id,index,{name:e.target.value})}/>
         <div className="sq-additional"><label>Available qty<input className="sq-control" aria-label="Variation quantity" type="number" min="0" step="any" inputMode="decimal" disabled={!editable||busy} value={v.quantity??''} onChange={e=>setVariation(item.id,index,{quantity:e.target.value})}/></label><label>Rate (Rs.)<input className="sq-control" aria-label="Variation price" type="number" min="0" step=".01" inputMode="decimal" disabled={!editable||busy} value={v.price??''} onChange={e=>setVariation(item.id,index,{price:e.target.value})}/></label></div>
         {editable&&<label style={{marginTop:7}}>Variation photo<input type="file" aria-label="Variation photo" accept="image/*" disabled={imagesBusy} onChange={e=>addImage(item.id,index,e.target.files?.[0])}/></label>}
         {v.image&&<img src={v.image} alt="Alternative variation" width={70} height={70} style={{marginTop:6,borderRadius:7}}/>}
         {editable&&<button className="sq-link" type="button" disabled={busy} onClick={()=>setItem(item.id,{variations:row.variations.filter((_,i)=>i!==index)})}>Remove variation</button>}
        </div>)}
        <details>
         <summary>Optional charges, notes and item-specific delivery</summary>
         <div className="sq-additional">
          {[['discount','Discount %'],['tax','Tax %'],['freight_unit','Freight per unit (Rs.)'],['moq','Minimum qty'],['multiple','Order multiple'],['lead_days','Delivery days']].map(([key,label])=><label key={key}>{label}<input className="sq-control" aria-label={label+' for '+item.description} disabled={!editable||busy} type="number" min="0" step={key==='lead_days'?'1':'any'} value={row[key]??''} onChange={e=>setItem(item.id,{[key]:e.target.value})}/></label>)}
          <label style={{gridColumn:'1/-1'}}>Valid through<input className="sq-control" type="date" aria-label={'Valid through for '+item.description} disabled={!editable||busy} value={row.valid_until||''} onChange={e=>setItem(item.id,{valid_until:e.target.value})}/></label>
         </div>
         <label style={{marginTop:6}}>Notes (optional)<input className="sq-control" value={row.notes||''} maxLength={500} disabled={!editable||busy} placeholder="Colour, delivery conditions etc." onChange={e=>setItem(item.id,{notes:e.target.value})}/></label>
        </details>
       </div>}
      </section>
     })}
    </div>
    <div className="sq-box" style={{display:'flex',justifyContent:'space-between',gap:12,alignItems:'center'}}>
     <strong style={{fontSize:13}}>Indicative quoted amount</strong>
     <strong style={{fontSize:17}}>Rs. {money(total)}</strong>
    </div>
    <p className="sq-muted" style={{margin:'0 4px 11px'}}>Based on requested units that can be supplied, before any optional charges or discounts. GH calculates final eligible landed cost, selects approved suppliers and generates POs after the round closes. Alternative variations are reviewed separately.</p>
    {editable&&<div className="sq-box sq-footer">
     <label style={{display:'flex',gap:8,alignItems:'flex-start',fontSize:13,marginBottom:10}}><input type="checkbox" disabled={busy} checked={agreed} onChange={e=>setAgreed(e.target.checked)}/> I confirm the exact items and units, rates, stock quantities, delivery and validity terms. Any discounts, taxes or freight not entered are zero.</label>
     <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr)',gap:8}}>
      <button type="button" className="sq-secondary" disabled={busy} onClick={()=>submit(false)}>Save draft</button>
      <button type="button" className="sq-primary" disabled={busy||!agreed||answered!==lines.length} onClick={()=>submit(true)}>{busy?'Saving…':'Final confirm'}</button>
     </div>
    </div>}
    {!editable&&<div className="sq-box">Editing is unavailable. Contact General Hardware to revise or reopen this quotation.</div>}
   </>}
  </div>
 </main>
}
