import sharp from 'sharp'
import path from 'node:path'
const escapeXml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const wrap=value=>String(value).match(/.{1,65}(?:\s|$)|.{1,65}/g)||['']
export async function supplierPoImages(job){
 if(!job.lines?.length||job.lines.length>35)throw Error('Use manual dispatch for this order')
 await sharp({text:{text:'.',font:'DejaVu Sans',fontfile:path.join(process.cwd(),'assets/fonts/DejaVuSans.ttf')}}).png().toBuffer()
 let y=160
 const rows=job.lines.map((line,index)=>{
  const text=wrap(line.description),height=Math.max(65,text.length*28+18)
  const row=`<rect x="20" y="${y}" width="1160" height="${height}" fill="${index%2?'#edf2f7':'white'}"/>`+text.map((t,i)=>`<text x="30" y="${y+30+i*28}" font-size="23">${escapeXml(t)}</text>`).join('')+`<text x="900" y="${y+30}" font-size="23">${escapeXml(line.qty+' '+line.uom)}</text>`
  y+=height;return row
 })
 if(y>4000)throw Error('Use manual dispatch for a long order')
 const header=wrap(job.supplier).map((t,i)=>`<text x="30" y="${85+i*25}" font-size="22">${escapeXml(t)}</text>`).join('')
 if(wrap(job.supplier).length>2)throw Error('Use manual dispatch for a long supplier name')
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${y+70}"><rect width="100%" height="100%" fill="white"/><g fill="#102339" font-family="DejaVu Sans"><text x="30" y="35" font-size="25">GENERAL HARDWARE — PURCHASE ORDER</text><text x="30" y="60" font-size="19">${escapeXml(job.po_no)}</text>${header}<text x="30" y="140" font-size="22">Description / Size</text><text x="900" y="140" font-size="22">Quantity / UOM</text>${rows.join('')}<text x="30" y="${y+40}" font-size="19">Please confirm availability and delivery.</text></g></svg>`
 return [await sharp(Buffer.from(svg)).png().toBuffer()]
}
