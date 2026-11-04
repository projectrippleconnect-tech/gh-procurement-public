const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function auditQuery(db,filters={}){
 let q=db.from('proc_audit_logs').select('*',{count:'exact'}).order('id',{ascending:false})
 for(const [field,key] of [['record_id','record'],['user_id','user']]){
  const value=String(filters[key]||'').trim()
  if(value){if(!UUID.test(value))throw Error('Enter a valid '+key+' ID');q=q.eq(field,value)}
 }
 if(filters.area)q=q.ilike('table_name','%'+String(filters.area).trim().replace(/[\\%_]/g,'\\$&')+'%')
 if(filters.action)q=q.eq('action',filters.action.trim())
 // Dates are shop dates, independently of the browser's timezone.
 if(filters.from)q=q.gte('created_at',filters.from+'T00:00:00+05:30')
 if(filters.to){const next=new Date(filters.to+'T00:00:00Z');next.setUTCDate(next.getUTCDate()+1);q=q.lt('created_at',next.toISOString().slice(0,10)+'T00:00:00+05:30')}
 return q
}
export async function completeAuditExport(fetchPage,{pageSize=500,maxRows=100000}={}){
 const rows=[];let cursor=null,ceiling=null
 for(;;){
  const result=await fetchPage({cursor,ceiling,pageSize})
  if(result.error)throw result.error
  const page=result.data||[]
  if(!page.length)return rows
  ceiling??=String(page[0].id)
  for(const row of page){
   const id=BigInt(row.id)
   if(id>BigInt(ceiling)||(cursor!==null&&id>=BigInt(cursor)))throw Error('Audit export order changed. Retry the export.')
   cursor=String(row.id);rows.push(row)
  }
  if(rows.length>maxRows)throw Error('Narrow the audit date range before exporting more than '+maxRows+' entries.')
  if(page.length<pageSize)return rows
 }
}
