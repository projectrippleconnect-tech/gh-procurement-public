import {deflateSync} from 'node:zlib'

// Simple dependency-free, 1-bit monochrome PNG renderer for unattended GH RFQ/PO.
// Reject unsupported glyphs rather than sending unreadable documents.
const FONT={"0":["01110","10001","10011","10101","11001","10001","01110"],"1":["00100","01100","00100","00100","00100","00100","01110"],"2":["01110","10001","00001","00010","00100","01000","11111"],"3":["11110","00001","00001","01110","00001","00001","11110"],"4":["00010","00110","01010","10010","11111","00010","00010"],"5":["11111","10000","10000","11110","00001","00001","11110"],"6":["01111","10000","10000","11110","10001","10001","01110"],"7":["11111","00001","00010","00100","01000","01000","01000"],"8":["01110","10001","10001","01110","10001","10001","01110"],"9":["01110","10001","10001","01111","00001","00001","11110"]," ":["00000","00000","00000","00000","00000","00000","00000"],"?":["01110","10001","00001","00110","00100","00000","00100"],"A":["01110","10001","10001","11111","10001","10001","10001"],"B":["11110","10001","10001","11110","10001","10001","11110"],"C":["01111","10000","10000","10000","10000","10000","01111"],"D":["11110","10001","10001","10001","10001","10001","11110"],"E":["11111","10000","10000","11110","10000","10000","11111"],"F":["11111","10000","10000","11110","10000","10000","10000"],"G":["01111","10000","10000","10111","10001","10001","01111"],"H":["10001","10001","10001","11111","10001","10001","10001"],"I":["11111","00100","00100","00100","00100","00100","11111"],"J":["00111","00010","00010","00010","10010","10010","01100"],"K":["10001","10010","10100","11000","10100","10010","10001"],"L":["10000","10000","10000","10000","10000","10000","11111"],"M":["10001","11011","10101","10101","10001","10001","10001"],"N":["10001","11001","10101","10011","10001","10001","10001"],"O":["01110","10001","10001","10001","10001","10001","01110"],"P":["11110","10001","10001","11110","10000","10000","10000"],"Q":["01110","10001","10001","10001","10101","10010","01101"],"R":["11110","10001","10001","11110","10100","10010","10001"],"S":["01111","10000","10000","01110","00001","00001","11110"],"T":["11111","00100","00100","00100","00100","00100","00100"],"U":["10001","10001","10001","10001","10001","10001","01110"],"V":["10001","10001","10001","10001","10001","01010","00100"],"W":["10001","10001","10001","10101","10101","10101","01010"],"X":["10001","10001","01010","00100","01010","10001","10001"],"Y":["10001","10001","01010","00100","00100","00100","00100"],"Z":["11111","00001","00010","00100","01000","10000","11111"],".":["00000","00000","00000","00000","00000","01100","01100"],",":["00000","00000","00000","00000","00110","00100","01000"],":":["00000","01100","01100","00000","01100","01100","00000"],"-":["00000","00000","00000","11111","00000","00000","00000"],"/":["00001","00001","00010","00100","01000","10000","10000"],"(":["00010","00100","01000","01000","01000","00100","00010"],")":["01000","00100","00010","00010","00010","00100","01000"],"+":["00000","00100","00100","11111","00100","00100","00000"],"#":["01010","01010","11111","01010","11111","01010","01010"],"&":["01100","10010","10100","01000","10101","10010","01101"],"%":["11001","11010","00100","01000","10110","00110","00000"],"'":["00100","00100","01000","00000","00000","00000","00000"],"=":["00000","00000","11111","00000","11111","00000","00000"],"\"":["01010","01010","00000","00000","00000","00000","00000"],"*":["00000","10101","01110","11111","01110","10101","00000"],"_":["00000","00000","00000","00000","00000","00000","11111"]}
const WIDTH=1536, MARGIN=48, SCALE=3, GLYPH_WIDTH=6*SCALE
const CRC_TABLE=Array.from({length:256},(_,n)=>{
 let c=n
 for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1)
 return c>>>0
})
const crc32=b=>{let c=0xffffffff;for(const byte of b)c=CRC_TABLE[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0}
const chunk=(type,data)=>{
 const name=Buffer.from(type)
 const len=Buffer.alloc(4);len.writeUInt32BE(data.length)
 const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([name,data])))
 return Buffer.concat([len,name,data,crc])
}
function glyphText(v){
 const text=String(v??'').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g,'')
  .replace(/[×✕]/g,'X').replace(/[’‘]/g,"'").replace(/[“”]/g,'"')
  .replace(/[–—]/g,'-').replace(/\u00a0/g,' ').toUpperCase()
 for(const ch of text)if(!FONT[ch])throw new Error('Unsupported character in supplier document: U+'+ch.codePointAt(0).toString(16).toUpperCase())
 return text
}
function wrapLine(s,max=77){
 let remaining=s,lines=[]
 while(remaining.length>max){
  const at=remaining.lastIndexOf(' ',max)
  const cut=at>max*0.5?at:max
  lines.push(remaining.slice(0,cut).trimEnd())
  remaining=remaining.slice(cut).trimStart()
 }
 lines.push(remaining)
 return lines
}
export function renderProcurementPng({kind,number,supplier,company='GENERAL HARDWARE',dueDate='',rows=[]}){
 const doc=kind==='po'?'PURCHASE ORDER':kind==='rfq'?'REQUEST FOR QUOTATION':null
 if(!doc)throw new Error('Invalid document kind')
 if(!Array.isArray(rows)||rows.length===0||rows.length>120)throw new Error('Supplier document must include 1-120 rows')
 const numberText=glyphText(number),supplierText=glyphText(supplier),companyText=glyphText(company)
 if(!numberText||!supplierText)throw new Error('Document number and supplier are required')
 const head=[companyText,doc,'NUMBER: '+numberText,'SUPPLIER: '+supplierText]
 if(dueDate)head.push('DATE: '+glyphText(dueDate))
 const lines=head.flatMap(s=>wrapLine(s))
 lines.push('-------------------------------------------------------------')
 for(let i=0;i<rows.length;i++){
  const row=rows[i]||{}
  const desc=glyphText(row.description)
  const size=glyphText(row.size||'')
  const qty=glyphText(row.qty)
  const uom=glyphText(row.uom||'')
  if(!desc||!qty||Number(row.qty)<=0||!Number.isFinite(Number(row.qty)))throw new Error('Incomplete supplier document row '+(i+1))
  const label=(i+1)+'. '+desc+(size?' / '+size:'')+' | QTY: '+qty+(uom?' '+uom:'')
  lines.push(...wrapLine(label))
  lines.push('')
 }
 lines.push('-------------------------------------------------------------')
 lines.push(kind==='po'?'PLEASE CONFIRM AVAILABILITY AND DELIVERY.':'PLEASE SEND UNIT PRICES AND AVAILABILITY.')
 const HEIGHT=Math.max(480,80+lines.length*32)
 if(HEIGHT>18000)throw new Error('Document too long for a WhatsApp PNG')
 const stride=Math.ceil(WIDTH/8),pixels=Buffer.alloc(stride*HEIGHT,255)
 const pixel=(x,y)=>{if(x>=0&&x<WIDTH&&y>=0&&y<HEIGHT)pixels[y*stride+(x>>3)]&=~(128>>(x&7))}
 const write=(s,x,y)=>{
  for(const ch of s){
   const g=FONT[ch]||FONT['?']
   for(let a=0;a<7;a++)for(let b=0;b<5;b++)if(g[a][b]==='1'){
    for(let dy=0;dy<SCALE;dy++)for(let dx=0;dx<SCALE;dx++)pixel(x+b*SCALE+dx,y+a*SCALE+dy)
   }
   x+=GLYPH_WIDTH
  }
 }
 lines.forEach((line,i)=>write(line.slice(0,78),MARGIN,48+i*32))
 // PNG grayscale 1-bit (0:black, 1:white). Each scanline begins with filter byte 0.
 const raw=Buffer.alloc((stride+1)*HEIGHT)
 for(let y=0;y<HEIGHT;y++)pixels.copy(raw,y*(stride+1)+1,y*stride,(y+1)*stride)
 const header=Buffer.alloc(13)
 header.writeUInt32BE(WIDTH,0);header.writeUInt32BE(HEIGHT,4)
 header[8]=1;header[9]=0 // 1-bit grayscale
 const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])
 if(png.length>4_500_000)throw new Error('Supplier PNG is too large')
 return {png,base64:png.toString('base64'),width:WIDTH,height:HEIGHT}
}
