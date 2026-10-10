'use client'

import {validateExtractionFile,validateExtractionPages,boundedCanvasSize} from './document-limits'

function cleanText(v){
 return String(v||'')
  .replace(/\u00a0/g,' ')
  .replace(/[–—]/g,'-')
  .replace(/[“”]/g,'"')
  .replace(/[‘’]/g,"'")
  .replace(/[ \t]+/g,' ')
  .trim()
}

function toNumber(v){
 const x=String(v||'').replace(/[^0-9.-]/g,'')
 if(!x)return null
 const n=Number(x)
 return Number.isFinite(n)?n:null
}

function detectSize(line){
 const patterns=[
  /\b\d+(?:\.\d+)?\s?(?:ml|ltr|litre|liter|l|kg|gm|g|mm|cm|mtr|m|ft|feet|inch|in)\b/i,
  /\b\d+\s?[x×]\s?\d+(?:\s?[x×]\s?\d+)?(?:\s?(?:mm|cm|m|ft|in))?\b/i,
  /\b\d+\s?['"]\b/,
  /\b\d+\/\d+\s?['"]?\b/
 ]
 for(const p of patterns){const m=line.match(p);if(m)return m[0]}
 return ''
}

function detectUom(line){
 const m=line.match(/\b(PCS?|PC|EA|EACH|BOX|BOXES|TIN|TINS|BAG|BAGS|PKT|PACK|PACKET|ROLL|SET|SETS|DOZ|DOZEN|PAIR|PAIRS|BOTTLE|BTL|CAN|CANS|TUBE|TUBES|SHEET|SHEETS|NOS?)\b/i)
 if(!m)return ''
 const v=m[1].toUpperCase()
 const map={PC:'PCS',PCS:'PCS',EA:'PCS',EACH:'PCS',NO:'PCS',NOS:'PCS',BOXES:'BOX',TINS:'TIN',BAGS:'BAG',PKT:'PKT',PACK:'PKT',PACKET:'PKT',ROLL:'ROLL',SETS:'SET',DOZEN:'DOZ',PAIRS:'PAIR',BOTTLE:'BTL',TUBES:'TUBE',SHEETS:'SHEET',CANS:'CAN'}
 return map[v]||v
}

function likelyHeader(line){
 const s=line.toLowerCase()
 if(s.length<3)return true
 const phrases=['price list','pricelist','page ','telephone','tel:','email','address','effective date','valid from','company name','description qty','item description','product description']
 return phrases.some(x=>s.includes(x))
}

function parseLine(raw,listType='mrp',page=1,confidence=null){
 const line=cleanText(raw)
 if(!line||likelyHeader(line))return null

 const amountMatches=[...line.matchAll(/(?:rs\.?|lkr)?\s*([0-9][0-9,]*(?:\.\d{1,4})?)/gi)]
 const amounts=amountMatches.map(m=>({raw:m[0],value:toNumber(m[1]),index:m.index})).filter(x=>x.value!==null)
 if(!amounts.length)return null

 const probable=amounts.filter(x=>x.value>=1)
 if(!probable.length)return null

 const firstToken=line.split(/\s+/)[0]||''
 const externalCode=/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._/-]{2,24}$/.test(firstToken)?firstToken:''
 const size=detectSize(line)
 const uom=detectUom(line)

 let mrp=null,cost=null
 if(listType==='cost'&&probable.length>=2){
  mrp=probable[probable.length-2].value
  cost=probable[probable.length-1].value
 }else{
  mrp=probable[probable.length-1].value
 }

 const priceIndex=probable[listType==='cost'&&probable.length>=2?probable.length-2:probable.length-1].index||0
 let description=cleanText(line.slice(externalCode.length,Math.max(0,priceIndex)))
 if(size)description=cleanText(description.replace(size,' '))
 if(uom)description=cleanText(description.replace(new RegExp('\\b'+uom+'\\b','i'),' '))
 description=description.replace(/[-:|]+$/,'').trim()

 if(description.length<2)return null
 return {
  external_code:externalCode||null,
  description,
  size:size||null,
  uom:uom||null,
  mrp,
  cost,
  discount_percent:0,
  extra_discount_percent:0,
  tax_percent:0,
  raw_line:line,
  source_page:page,
  extraction_confidence:confidence==null?(externalCode?88:74):Math.max(0,Math.min(100,Number(confidence))),
  match_status:'unmatched'
 }
}

export function parsePriceListText(text,listType='mrp',page=1,confidence=null){
 const seen=new Set(),rows=[]
 for(const raw of String(text||'').split(/\r?\n/)){
  const row=parseLine(raw,listType,page,confidence)
  if(!row)continue
  const key=[row.external_code||'',row.description.toLowerCase(),row.size||'',row.mrp??'',row.cost??''].join('|')
  if(seen.has(key))continue
  seen.add(key);rows.push(row)
 }
 return rows
}

function parseTsvLines(tsv){
 const groups=new Map()
 const lines=String(tsv||'').split(/\r?\n/)
 for(let i=1;i<lines.length;i++){
  const cells=lines[i].split('\t')
  if(cells.length<12||cells[0]!=='5')continue
  const text=cleanText(cells.slice(11).join('\t'))
  if(!text)continue
  const key=[cells[1],cells[2],cells[3],cells[4]].join(':')
  const g=groups.get(key)||{top:Number(cells[7]||0),left:Number(cells[6]||0),words:[],confidence:[]}
  g.top=Math.min(g.top,Number(cells[7]||0));g.left=Math.min(g.left,Number(cells[6]||0))
  g.words.push({left:Number(cells[6]||0),text})
  const conf=Number(cells[10]);if(Number.isFinite(conf)&&conf>=0)g.confidence.push(conf)
  groups.set(key,g)
 }
 return [...groups.values()]
  .sort((a,b)=>Math.abs(a.top-b.top)>4?a.top-b.top:a.left-b.left)
  .map(g=>({
    text:g.words.sort((a,b)=>a.left-b.left).map(w=>w.text).join('   '),
    confidence:g.confidence.length?g.confidence.reduce((a,b)=>a+b,0)/g.confidence.length:null
  }))
}

function groupPdfItems(items){
 const groups=[]
 for(const it of items||[]){
  const str=cleanText(it.str)
  if(!str)continue
  const x=Number(it.transform?.[4]||0),y=Number(it.transform?.[5]||0)
  let g=groups.find(v=>Math.abs(v.y-y)<2)
  if(!g){g={y,parts:[]};groups.push(g)}
  g.parts.push({x,str})
 }
 groups.sort((a,b)=>b.y-a.y)
 return groups.map(g=>g.parts.sort((a,b)=>a.x-b.x).map(p=>p.str).join('   ')).join('\n')
}

async function makeOcrWorker(onProgress){
 const {createWorker}=await import('tesseract.js')
 const worker=await createWorker('eng',1,{
  workerPath:'/tesseract/worker.min.js',
  corePath:'/tesseract-core',
  langPath:'https://tessdata.projectnaptha.com/4.0.0',
  workerBlobURL:false,
  logger:m=>{
   if(m?.status&&typeof m.progress==='number')onProgress?.({stage:m.status,progress:m.progress})
  },
  errorHandler:err=>onProgress?.({stage:'OCR worker error: '+String(err?.message||err),progress:0})
 })
 await worker.setParameters({preserve_interword_spaces:'1',user_defined_dpi:'300'})
 return worker
}

async function imageToOcrCanvas(blob){
 const url=URL.createObjectURL(blob)
 try{
  const img=new Image()
  await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url})
  const dimensions=boundedCanvasSize(img.naturalWidth,img.naturalHeight,{upscale:true})
  const canvas=document.createElement('canvas')
  canvas.width=dimensions.width
  canvas.height=dimensions.height
  const ctx=canvas.getContext('2d',{alpha:false,willReadFrequently:false})
  if(!ctx)throw new Error('This browser could not prepare the image for OCR.')
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.imageSmoothingEnabled=true
  ctx.imageSmoothingQuality='high'
  ctx.drawImage(img,0,0,canvas.width,canvas.height)
  return canvas
 }finally{
  URL.revokeObjectURL(url)
 }
}

async function ocrBlob(blob,worker,onProgress){
 onProgress?.({stage:'Preparing image for OCR',progress:0})
 const image=await imageToOcrCanvas(blob)
 onProgress?.({stage:'Reading text',progress:0.05})
 const ret=await worker.recognize(image,{rotateAuto:true},{text:true,tsv:true})
 const tsvLines=parseTsvLines(ret?.data?.tsv)
 onProgress?.({stage:'OCR complete',progress:1})
 return {
  text:tsvLines.length?tsvLines.map(x=>x.text).join('\n'):(ret?.data?.text||''),
  lines:tsvLines
 }
}

async function extractPdf(file,onProgress){
 const pdfjs=await import('pdfjs-dist/build/pdf.mjs')
 pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs'
 const data=new Uint8Array(await file.arrayBuffer())
 const loadingTask=pdfjs.getDocument({data})
 const pages=[]
 let worker=null
 try{
  const pdf=await loadingTask.promise
  const maxPages=validateExtractionPages(pdf.numPages)
  for(let n=1;n<=maxPages;n++){
   onProgress?.({stage:'Reading PDF page '+n+' of '+maxPages,progress:(n-1)/maxPages})
   const page=await pdf.getPage(n)
   const tc=await page.getTextContent()
   let text=groupPdfItems(tc.items),ocrLines=[]
   const useful=cleanText(text).length>80
   if(!useful){
    if(!worker)worker=await makeOcrWorker(onProgress)
    const fullViewport=page.getViewport({scale:2})
    const dimensions=boundedCanvasSize(fullViewport.width,fullViewport.height)
    const viewport=page.getViewport({scale:2*dimensions.scale})
    const canvas=document.createElement('canvas')
    canvas.width=dimensions.width;canvas.height=dimensions.height
    const ctx=canvas.getContext('2d',{alpha:false})
    if(!ctx)throw new Error('This browser could not prepare the PDF page for OCR.')
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height)
    await page.render({canvasContext:ctx,viewport}).promise
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.94))
    const ocr=blob?await ocrBlob(blob,worker,onProgress):{text:'',lines:[]}
    text=ocr.text;ocrLines=ocr.lines
   }
   pages.push({page:n,text,ocrLines})
   page.cleanup()
  }
 }finally{
  try{if(worker)await worker.terminate()}finally{await loadingTask.destroy()}
 }
 onProgress?.({stage:'PDF read',progress:1})
 return pages
}

export async function extractDocumentTextFile(file,onProgress){
 validateExtractionFile(file)
 const mime=String(file.type||'').toLowerCase()
 let pages=[]
 if(mime==='application/pdf'||file.name?.toLowerCase().endsWith('.pdf')){
  pages=await extractPdf(file,onProgress)
 }else if(mime.startsWith('image/')){
  const worker=await makeOcrWorker(onProgress)
  try{
   const ocr=await ocrBlob(file,worker,onProgress)
   pages=[{page:1,text:ocr.text,ocrLines:ocr.lines}]
  }finally{
   await worker.terminate()
  }
 }else{
  throw new Error('OCR supports PDF, JPG, PNG and WebP files.')
 }
 return {pages,rawText:pages.map(p=>'--- Page '+p.page+' ---\n'+p.text).join('\n')}
}

export async function extractPriceListFile(file,listType='mrp',onProgress){
 validateExtractionFile(file)
 const mime=String(file.type||'').toLowerCase()
 let pages=[]
 if(mime==='application/pdf'||file.name?.toLowerCase().endsWith('.pdf')){
  pages=await extractPdf(file,onProgress)
 }else if(mime.startsWith('image/')){
  const worker=await makeOcrWorker(onProgress)
  try{
   const ocr=await ocrBlob(file,worker,onProgress)
   pages=[{page:1,text:ocr.text,ocrLines:ocr.lines}]
  }finally{
   await worker.terminate()
  }
 }else{
  throw new Error('Extraction supports PDF, JPG, PNG and WebP files.')
 }

 const rows=[],seen=new Set()
 for(const p of pages){
  const sourceLines=p.ocrLines?.length?p.ocrLines:[]
  if(sourceLines.length){
   for(const l of sourceLines){
    const row=parseLine(l.text,listType,p.page,l.confidence)
    if(!row)continue
    const key=[row.external_code||'',row.description.toLowerCase(),row.size||'',row.mrp??'',row.cost??''].join('|')
    if(seen.has(key))continue
    seen.add(key);rows.push(row)
   }
  }else{
   for(const row of parsePriceListText(p.text,listType,p.page)){
    const key=[row.external_code||'',row.description.toLowerCase(),row.size||'',row.mrp??'',row.cost??''].join('|')
    if(seen.has(key))continue
    seen.add(key);rows.push(row)
   }
  }
 }

 if(!rows.length)throw new Error('OCR finished, but no product rows with prices were detected. Adjust the crop to include the product table and try again.')
 return {rows,pages,rawText:pages.map(p=>'--- Page '+p.page+' ---\n'+p.text).join('\n')}
}
