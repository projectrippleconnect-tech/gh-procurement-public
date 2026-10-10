// Supabase's API row cap also applies when a caller asks for a larger limit.
// Use a fresh, deterministically ordered query builder for every page.
export async function allRows(query,pageSize=500){
 const data=[]
 for(let offset=0;;offset+=pageSize){
  const result=await query().range(offset,offset+pageSize-1)
  if(result.error)return {...result,data:[]}
  const rows=result.data||[]
  data.push(...rows)
  if(rows.length<pageSize)return {...result,data}
 }
}

// Quote each PostgREST value so punctuation cannot become filter syntax.
export function containsAny(columns,term){
 const value=JSON.stringify('%'+String(term)+'%')
 return columns.map(column=>column+'.ilike.'+value).join(',')
}
