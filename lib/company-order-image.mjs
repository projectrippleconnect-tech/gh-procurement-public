import sharp from 'sharp'
import path from 'node:path'
let fontReady
function prepareFont(){
 // Register the bundled font with libvips/fontconfig before SVG rendering.
 // The Railway runtime need not have any system fonts installed.
 return fontReady??=sharp({text:{text:'.',font:'DejaVu Sans',fontfile:path.join(process.cwd(),'assets/fonts/DejaVuSans.ttf')}}).png().toBuffer()
}
const xml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const wrap=(value,width)=>{
 const out=[]
 for(const paragraph of String(value??'').split(/\r?\n/)){
  let line=''
  for(const word of paragraph.split(/\s+/).filter(Boolean)){
   for(let start=0;start<word.length;start+=width){
    const part=word.slice(start,start+width)
    if(line.length+part.length+1>width){out.push(line);line=''}
    line+=(line?' ':'')+part
   }
  }
  out.push(line)
 }
 return out
}
export async function companyOrderImages(job){
 if(!Array.isArray(job.lines)||!job.lines.length)throw new Error('The purchase order has no items.')
 await prepareFont()
 const pages=[];let rows=[],height=0
 for(let index=0;index<job.lines.length;index++){
  const l=job.lines[index]
  const description=wrap([l.description,l.brand,l.size,l.colour,l.variation,l.remarks].filter(Boolean).join(' · '),65)
  const qty=wrap(String(l.qty)+' '+String(l.uom||''),16)
  const h=Math.max(description.length,qty.length)*27+20
  if(h>2200)throw new Error('An item description is too long for the WhatsApp image. Shorten its remarks.')
  if(height+h>2200&&rows.length){pages.push(rows);rows=[];height=0}
  rows.push({index:index+1,description,qty,h});height+=h
 }
 if(rows.length)pages.push(rows)
 const output=[]
 for(let p=0;p<pages.length;p++){
  const header=wrap('Company: '+job.company+' · Supplier: '+job.supplier,85)
  let y=125+header.length*27
  const texts=header.map((line,i)=>`<text x="30" y="${100+i*27}" font-size="22">${xml(line)}</text>`)
  texts.push(`<text x="30" y="${y}" font-size="22" font-weight="bold">No. / Description</text><text x="980" y="${y}" font-size="22" font-weight="bold">Quantity</text>`)
  y+=20
  for(const row of pages[p]){
   texts.push(`<rect x="20" y="${y}" width="1160" height="${row.h}" fill="${row.index%2?'#f1f5f9':'#ffffff'}"/>`)
   row.description.forEach((line,i)=>texts.push(`<text x="30" y="${y+30+i*27}" font-size="23">${xml((i===0?row.index+'. ':'')+line)}</text>`))
   row.qty.forEach((line,i)=>texts.push(`<text x="980" y="${y+30+i*27}" font-size="23">${xml(line)}</text>`))
   y+=row.h
  }
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${y+125}"><rect width="100%" height="100%" fill="white"/><g font-family="DejaVu Sans" fill="#102339"><text x="30" y="42" font-size="30" font-weight="bold">GENERAL HARDWARE — PURCHASE ORDER</text><text x="30" y="73" font-size="23">${xml(job.po_no)} · Page ${p+1}/${pages.length}</text>${texts.join('')}<text x="30" y="${y+40}" font-size="20">Please confirm availability and delivery. Quantity-only order.</text><text x="30" y="${y+80}" font-size="17">Stocks Checked By     Stocks Verified By     Order Approved By     Date</text></g></svg>`
  output.push(await sharp(Buffer.from(svg)).png().toBuffer())
 }
 return output
}
