const safeText=value=>String(value??'').trim()

const cleanFilename=value=>safeText(value).replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-|-$/g,'')

const formatQty=value=>{
 const n=Number(value)
 if(!Number.isFinite(n))return safeText(value)
 return new Intl.NumberFormat('en-LK',{maximumFractionDigits:3}).format(n)
}

const rfqRows=items=>(items||[]).map((x,index)=>{
 const item=x?.requirement?.item||x?.item||{}
 const description=safeText(item.description)
 const size=safeText(item.size)
 const itemLabel=size&&description.toLowerCase().includes(size.toLowerCase())?description:[description,size].filter(Boolean).join(' · ')
 return {
  no:index+1,
  qty:formatQty(x?.requested_qty??x?.qty??''),
  uom:safeText(item.uom),
  item:itemLabel||'Item'
 }
})

export function buildSupplierQuoteReplyText({rfq,items,supplier,company}={}){
 const companyName=safeText(company?.name)||'General Hardware'
 const rows=rfqRows(items)
 const lines=rows.map(r=>[
  `${String(r.no).padStart(2,'0')}. ${r.qty} ${r.uom} | ${r.item}`.trim(),
  '    Rate: Rs. ______'
 ].join('\n')).join('\n\n')
 return [
  `${companyName.toUpperCase()} — PRICE REQUEST`,
  `RFQ: ${safeText(rfq?.rfq_no)||'—'}`,
  supplier?.name?`Supplier: ${safeText(supplier.name)}`:null,
  rfq?.due_date?`Due: ${safeText(rfq.due_date)}`:null,
  '',
  'Please copy this message into your reply and replace the blanks.',
  'Enter the unit rate after each item. If an item is unavailable, write N/A.',
  '',
  lines,
  '',
  'Availability: ______',
  'Delivery / Lead Time: ______',
  'Payment Terms: ______',
  'Quote Reference: ______'
 ].filter(x=>x!==null).join('\n')
}

export function buildSupplierPngShareText({rfq,company}={}){
 const companyName=safeText(company?.name)||'General Hardware'
 return [
  `${companyName} — Supplier Price Request`,
  `RFQ: ${safeText(rfq?.rfq_no)||'—'}`,
  rfq?.due_date?`Due: ${safeText(rfq.due_date)}`:null,
  'Please see the attached RFQ image and reply with your unit rates, availability, delivery time and terms.'
 ].filter(Boolean).join('\n')
}

const wrapLines=(ctx,text,maxWidth)=>{
 const words=safeText(text).split(/\s+/).filter(Boolean)
 if(!words.length)return ['']
 const lines=[]
 let line=''
 for(const word of words){
  const next=line?`${line} ${word}`:word
  if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word}
  else line=next
 }
 if(line)lines.push(line)
 return lines
}

const roundRect=(ctx,x,y,w,h,r)=>{
 const radius=Math.min(r,w/2,h/2)
 ctx.beginPath()
 ctx.moveTo(x+radius,y)
 ctx.arcTo(x+w,y,x+w,y+h,radius)
 ctx.arcTo(x+w,y+h,x,y+h,radius)
 ctx.arcTo(x,y+h,x,y,radius)
 ctx.arcTo(x,y,x+w,y,radius)
 ctx.closePath()
}

export async function createSupplierPriceRequestPng({rfq,items,supplier,company}={}){
 if(typeof document==='undefined')throw new Error('PNG export is available in the browser.')
 const rows=rfqRows(items)
 const width=1200,pad=54
 const cols=[
  {key:'no',label:'#',w:70,align:'center'},
  {key:'qty',label:'QTY',w:145,align:'right'},
  {key:'uom',label:'UOM',w:110,align:'center'},
  {key:'item',label:'ITEM / SIZE',w:565,align:'left'},
  {key:'rate',label:'UNIT RATE',w:200,align:'center'}
 ]
 const measure=document.createElement('canvas').getContext('2d')
 measure.font='600 28px Arial, sans-serif'
 const prepared=rows.map(r=>{
  const itemLines=wrapLines(measure,r.item,cols[3].w-28)
  return {...r,itemLines,rowH:Math.max(76,34*itemLines.length+28)}
 })
 const headerH=250,tableHeadH=64,footerH=190
 const height=Math.max(900,headerH+tableHeadH+prepared.reduce((s,r)=>s+r.rowH,0)+footerH+pad)
 const canvas=document.createElement('canvas')
 canvas.width=width;canvas.height=height
 const ctx=canvas.getContext('2d')
 if(!ctx)throw new Error('Could not create RFQ image.')

 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height)
 ctx.fillStyle='#10233f';ctx.fillRect(0,0,width,headerH)
 ctx.fillStyle='#f4c430';ctx.fillRect(0,headerH-10,width,10)

 const companyName=safeText(company?.name)||'GENERAL HARDWARE'
 ctx.fillStyle='#ffffff'
 ctx.font='700 42px Arial, sans-serif'
 ctx.fillText(companyName.toUpperCase(),pad,64)
 ctx.font='700 30px Arial, sans-serif'
 ctx.fillText('REQUEST FOR QUOTATION',pad,112)
 ctx.font='500 25px Arial, sans-serif'
 const meta=[
  `RFQ: ${safeText(rfq?.rfq_no)||'—'}`,
  `Supplier: ${safeText(supplier?.name)||'—'}`,
  `Due: ${safeText(rfq?.due_date)||'—'}`
 ]
 meta.forEach((m,i)=>ctx.fillText(m,pad,158+i*32))

 let y=headerH
 const x0=pad
 ctx.font='700 23px Arial, sans-serif'
 let x=x0
 cols.forEach(col=>{
  ctx.fillStyle='#e9eef6';ctx.fillRect(x,y,col.w,tableHeadH)
  ctx.strokeStyle='#bcc7d6';ctx.lineWidth=2;ctx.strokeRect(x,y,col.w,tableHeadH)
  ctx.fillStyle='#10233f'
  const tw=ctx.measureText(col.label).width
  const tx=col.align==='left'?x+14:col.align==='right'?x+col.w-14-tw:x+(col.w-tw)/2
  ctx.fillText(col.label,tx,y+40)
  x+=col.w
 })
 y+=tableHeadH

 ctx.font='600 27px Arial, sans-serif'
 prepared.forEach((row,index)=>{
  x=x0
  const vals={no:String(row.no),qty:row.qty,uom:row.uom,rate:'Rs. ______'}
  cols.forEach(col=>{
   ctx.fillStyle=index%2===0?'#ffffff':'#f8fafc'
   ctx.fillRect(x,y,col.w,row.rowH)
   ctx.strokeStyle='#d3dbe6';ctx.lineWidth=2;ctx.strokeRect(x,y,col.w,row.rowH)
   ctx.fillStyle='#152238'
   if(col.key==='item'){
    row.itemLines.forEach((line,li)=>ctx.fillText(line,x+14,y+31+li*34))
   }else{
    const value=vals[col.key]||''
    const tw=ctx.measureText(value).width
    const tx=col.align==='left'?x+14:col.align==='right'?x+col.w-14-tw:x+(col.w-tw)/2
    ctx.fillText(value,tx,y+Math.min(row.rowH-22,43))
   }
   x+=col.w
  })
  y+=row.rowH
 })

 y+=34
 ctx.fillStyle='#f8fafc'
 roundRect(ctx,pad,y,width-pad*2,128,18);ctx.fill()
 ctx.strokeStyle='#d3dbe6';ctx.lineWidth=2;ctx.stroke()
 ctx.fillStyle='#10233f';ctx.font='700 24px Arial, sans-serif'
 ctx.fillText('PLEASE REPLY WITH:',pad+24,y+36)
 ctx.font='500 23px Arial, sans-serif'
 ctx.fillText('Unit Rate  •  Availability  •  Delivery / Lead Time  •  Payment Terms',pad+24,y+72)
 ctx.fillText('Tip: reply using the item number (01, 02, 03...) so prices are easy to match.',pad+24,y+106)

 return await new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>blob?resolve({
   blob,
   filename:`${cleanFilename(rfq?.rfq_no||'RFQ')}-${cleanFilename(supplier?.name||'Supplier')}.png`
  }):reject(new Error('Could not create RFQ PNG.')),'image/png',0.95)
 })
}

export function downloadBlob(blob,filename){
 const url=URL.createObjectURL(blob)
 const a=document.createElement('a')
 a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove()
 setTimeout(()=>URL.revokeObjectURL(url),1200)
}

export async function downloadSupplierPriceRequestPng(args){
 const out=await createSupplierPriceRequestPng(args)
 downloadBlob(out.blob,out.filename)
 return out
}

// The RFQ panel pre-renders this file before the user taps Share. Avoid awaiting
// toBlob before navigator.share: mobile browsers require transient activation.
export async function shareSupplierPriceRequestPng(args,prepared=null){
 const out=prepared||await createSupplierPriceRequestPng(args)
 const text=buildSupplierQuoteReplyText(args)
 if(typeof File!=='undefined'){
  const file=new File([out.blob],out.filename,{type:'image/png'})
  if(typeof navigator!=='undefined'&&navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
   try{
    await navigator.share({title:`RFQ ${safeText(args?.rfq?.rfq_no)}`,text,files:[file]})
    return {shared:true,...out}
   }catch(error){
    if(error?.name==='AbortError')throw error
    throw new Error('Could not share the RFQ image and text. Retry, or use Download PNG and Copy Reply Text. '+(error?.message||''))
   }
  }
 }
 downloadBlob(out.blob,out.filename)
 return {shared:false,...out,text}
}
