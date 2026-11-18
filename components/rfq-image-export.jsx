'use client'
import {useEffect,useMemo,useState} from 'react'
import {createSupplierPriceRequestPngs,downloadBlob} from '@/lib/rfq-share'

export function RfqImageExport({rows,fail}){
 const[perImage,setPerImage]=useState(30),[pages,setPages]=useState([]),[busy,setBusy]=useState(false)
 const args=useMemo(()=>{
  const sources=[...new Set(rows.map(r=>r.source_count_no).filter(Boolean))]
  return {rfq:{rfq_no:sources.length===1?'STOCK-'+sources[0]:'APPROVED-ITEMS'},company:{name:'General Hardware'},itemsPerImage:perImage,items:rows.map(r=>({id:r.id,requested_qty:r.remaining_to_order,requirement:{item:{description:r.description,size:r.size,uom:r.uom}}}))}
 },[rows,perImage])
 useEffect(()=>{
  let cancelled=false,urls=[]
  setBusy(true);setPages([])
  createSupplierPriceRequestPngs(args).then(result=>{
   if(cancelled)return
   const next=result.map(page=>({...page,url:URL.createObjectURL(page.blob)}));urls=next.map(p=>p.url);setPages(next)
  }).catch(error=>{if(!cancelled)fail(error)}).finally(()=>{if(!cancelled)setBusy(false)})
  return()=>{cancelled=true;urls.forEach(url=>URL.revokeObjectURL(url))}
 },[args,fail])
 async function share(){
  try{
   const files=pages.map(p=>new File([p.blob],p.filename,{type:'image/png'}))
   if(navigator.share&&navigator.canShare?.({files}))await navigator.share({title:'General Hardware price request',text:'Please quote unit prices and availability for all '+rows.length+' items across '+pages.length+' images.',files})
   else pages.forEach(p=>downloadBlob(p.blob,p.filename))
  }catch(e){if(e.name!=='AbortError')fail(e)}
 }
 return <section className="card pad section" aria-label="Approved item RFQ images"><div className="sectionhead"><div><h3>RFQ images · {rows.length} approved items</h3><p>One price request, numbered across {Math.ceil(rows.length/perImage)} images. Download now or choose suppliers below to save an RFQ.</p></div></div><div className="toolbar"><label className="compact-field"><span>Items per image</span><select className="select" value={perImage} onChange={e=>setPerImage(Number(e.target.value))}>{[20,30,40].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button className="btn primary" disabled={busy||!pages.length} onClick={()=>pages.forEach(p=>downloadBlob(p.blob,p.filename))}>Download all {pages.length||''} images</button><button className="btn" disabled={busy||!pages.length} onClick={share}>Share images</button></div>{busy&&<p role="status">Preparing all RFQ images…</p>}<div className="formgrid section">{pages.map(p=><div key={p.filename}><a href={p.url} download={p.filename}>Download image {p.pageNumber} of {p.pageCount}</a><details><summary>Preview image {p.pageNumber}</summary><img src={p.url} alt={'RFQ image '+p.pageNumber+' of '+p.pageCount} style={{display:'block',width:'100%',maxWidth:340,height:'auto',marginTop:8}}/></details></div>)}</div></section>
}
