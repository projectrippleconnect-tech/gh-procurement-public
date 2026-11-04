// Export only after every filtered page succeeds; never label a partial download complete.
export async function completeReport(fetchPage,pageSize=1000,maxRows=100000){
 const rows=[]
 for(let offset=0;;offset+=pageSize){
  const page=await fetchPage(offset,pageSize)
  if(page.error)throw page.error
  rows.push(...(page.data||[]))
  if((page.data||[]).length<pageSize)return rows
  if(offset+pageSize>=maxRows)throw new Error('Report exceeds 100,000 rows. Narrow the date range before exporting.')
 }
}
