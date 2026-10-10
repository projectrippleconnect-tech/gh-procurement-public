import {downloadBlob} from './rfq-share.js'
const text=v=>String(v??'').trim()
const number=v=>Number(v||0).toLocaleString('en-LK',{maximumFractionDigits:3})
const price=v=>Number(v||0).toLocaleString('en-LK',{minimumFractionDigits:2,maximumFractionDigits:2})
export const PO_SHARE_FIELDS=[
 ['description','Description',true,l=>text(l.item?.description),5],
 ['size','Size',true,l=>text(l.item?.size),1.5],
 ['uom','UOM',true,l=>text(l.item?.uom),1],
 ['qty','Quantity',true,l=>number(l.qty),1.5],
 ['item_code','Item code',false,l=>text(l.item?.item_code),2],
 ['unit_price','Unit price',false,l=>price(l.unit_price),2],
 ['discount_percent','Discount %',false,l=>number(l.discount_percent)+'%',2],
 ['tax_percent','Tax %',false,l=>number(l.tax_percent)+'%',1.5],
 ['effective_unit_cost','Effective unit cost',false,l=>price(Number(l.unit_price||0)*(1-Number(l.discount_percent||0)/100)*(1+Number(l.tax_percent||0)/100)),2],
 ['landed_unit_cost','Landed unit cost',false,l=>l.landed_unit_cost==null?'':price(l.landed_unit_cost),2],
 ['line_total','Line total',false,l=>price(l.line_total),2],
 ['total','Order total',false,null,0],
 ['terms','Payment terms',false,null,0],
 ['expected_date','Expected delivery',false,null,0],
 ['notes','Notes',false,null,0]
]
export const defaultPoShareFields=()=>Object.fromEntries(PO_SHARE_FIELDS.map(([key,,enabled])=>[key,enabled]))
export function resolvePoShareFields(value){
 const defaults=defaultPoShareFields()
 for(const key of Object.keys(defaults))if(typeof value?.[key]==='boolean')defaults[key]=value[key]
 return defaults
}
export function purchaseOrderShareModel({po,lines,company,selection}={}){
 const selected=resolvePoShareFields(selection)
 const columns=PO_SHARE_FIELDS.filter(([key,,,get])=>get&&selected[key]).map(([key,label,,get,weight])=>({key,label,get,weight}))
 if(!columns.length)throw new Error('Enable at least one purchase-order item field.')
 if(!lines?.length)throw new Error('Purchase-order items are still loading or unavailable.')
 const meta=[['PO',text(po?.po_no)],['Supplier',text(po?.supplier?.name)],['PO date',text(po?.po_date)]]
 if(selected.expected_date&&po?.expected_date)meta.push(['Expected delivery',text(po.expected_date)])
 if(selected.terms&&(po?.terms||po?.supplier?.payment_terms))meta.push(['Payment terms',text(po.terms||po.supplier.payment_terms)])
 if(selected.notes&&po?.notes)meta.push(['Notes',text(po.notes)])
 return {company:text(company?.name)||'General Hardware',columns,rows:lines.map(l=>columns.map(c=>c.get(l))),meta,total:selected.total?'LKR '+price(po?.total):null}
}
export function buildPurchaseOrderText(args){
 const m=purchaseOrderShareModel(args)
 return [m.company.toUpperCase()+' — PURCHASE ORDER',...m.meta.map(([k,v])=>k+': '+v),'',...m.rows.map((r,i)=>(i+1)+'. '+r.map((v,n)=>m.columns[n].label+': '+v).join(' | ')),m.total?'\nTOTAL: '+m.total:'','\nPlease confirm availability and delivery.'].filter(Boolean).join('\n')
}
export function buildPurchaseOrderCaption({po,company}={}){
 return [(text(company?.name)||'General Hardware')+' — Purchase Order','PO: '+text(po?.po_no),'Supplier: '+text(po?.supplier?.name),'Please see the attached purchase-order image and confirm availability and delivery.'].join('\n')
}
const wrap=(ctx,value,width)=>{
 const result=[];let line=''
 for(const word of text(value).split(/\s+/)){
  for(const ch of (line?' ':'')+word){
   if(ctx.measureText(line+ch).width>width&&line){result.push(line);line=''}
   line+=ch
  }
 }
 if(line||!result.length)result.push(line)
 return result
}
export async function createPurchaseOrderPng(args){
 const m=purchaseOrderShareModel(args)
 const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d')
 if(!ctx)throw new Error('Could not create purchase-order image.')
 const width=1200,pad=42,available=width-pad*2,weight=m.columns.reduce((s,c)=>s+c.weight,0)
 const columns=m.columns.map(c=>({...c,width:available*c.weight/weight}))
 ctx.font='500 23px Arial, sans-serif'
 const rows=m.rows.map(r=>{const cells=r.map((v,i)=>wrap(ctx,v,columns[i].width-20));return {cells,height:Math.max(58,...cells.map(c=>c.length*29+20))}})
 const metas=m.meta.map(([k,v])=>wrap(ctx,k+': '+v,available))
 const header=130+metas.reduce((s,r)=>s+r.length*30,0)+24
 const headings=columns.map(c=>wrap(ctx,c.label.toUpperCase(),c.width-20))
 const head=Math.max(58,...headings.map(c=>c.length*29+20))
 const height=Math.max(600,header+head+rows.reduce((s,r)=>s+r.height,0)+150)
 if(height>20000)throw new Error('This purchase order is too tall for one WhatsApp image. Disable optional fields or use PDF.')
 canvas.width=width;canvas.height=height
 ctx.fillStyle='white';ctx.fillRect(0,0,width,height)
 ctx.fillStyle='#10233f';ctx.fillRect(0,0,width,header)
 ctx.fillStyle='white';ctx.font='700 34px Arial, sans-serif'
 wrap(ctx,m.company.toUpperCase(),available).slice(0,1).forEach(r=>ctx.fillText(r,pad,48))
 ctx.font='700 29px Arial, sans-serif';ctx.fillText('PURCHASE ORDER',pad,90)
 ctx.font='500 23px Arial, sans-serif';let my=126
 metas.forEach(r=>r.forEach(line=>{ctx.fillText(line,pad,my);my+=30}))
 let y=header
 const draw=(cells,h,bg,bold=false)=>{let x=pad;ctx.font=(bold?'700':'500')+' 23px Arial, sans-serif';columns.forEach((c,i)=>{ctx.fillStyle=bg;ctx.fillRect(x,y,c.width,h);ctx.strokeStyle='#ccd5e0';ctx.strokeRect(x,y,c.width,h);ctx.fillStyle='#10233f';cells[i].forEach((v,n)=>ctx.fillText(v,x+10,y+29+n*29));x+=c.width});y+=h}
 draw(headings,head,'#e9eef6',true)
 rows.forEach((r,i)=>draw(r.cells,r.height,i%2?'#f4f7fb':'white'))
 ctx.font='700 25px Arial, sans-serif';ctx.fillStyle='#10233f'
 if(m.total){y+=35;ctx.fillText('TOTAL: '+m.total,pad,y)}
 y+=50;ctx.font='500 19px Arial, sans-serif';ctx.fillText('Stocks Checked By       Stocks Verified By       Order Approved By       Date',pad,y)
 const filename=text(args.po?.po_no||'Purchase-Order').replace(/[^a-zA-Z0-9_-]/g,'-')+'.png'
 return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve({blob,filename}):reject(new Error('Could not encode PO image.')),'image/png'))
}
export async function downloadPurchaseOrderPng(args){const out=await createPurchaseOrderPng(args);downloadBlob(out.blob,out.filename);return out}
export async function sharePurchaseOrderPng(args){
 const out=await createPurchaseOrderPng(args),caption=buildPurchaseOrderCaption(args)
 const file=new File([out.blob],out.filename,{type:'image/png'})
 if(navigator.share&&navigator.canShare?.({files:[file]})){try{await navigator.share({title:'Purchase Order',text:caption,files:[file]});return {shared:true,...out}}catch(error){if(error?.name==='AbortError')throw error}}
 downloadBlob(out.blob,out.filename);return {shared:false,...out}
}
