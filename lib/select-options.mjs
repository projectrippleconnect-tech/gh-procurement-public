const key=value=>String(value??'').trim().replace(/\s+/g,' ').toUpperCase()

// Deduplicate presentation only. Keep distinct record IDs even when labels match,
// and keep the selected stored value so editing cannot silently replace it.
export function uniqueSelectOptions(options=[],current=''){
 const result=[],indices=new Map()
 for(const option of options){
  const value=String(option.value??'')
  const identity=key(value)===key(option.text)?'label:'+key(value):'value:'+value
  const index=indices.get(identity)
  if(index===undefined){indices.set(identity,result.length);result.push(option);continue}
  const previous=result[index]
  if(value===String(current)&&(previous.value!==String(current)||previous.disabled&&!option.disabled)||previous.disabled&&!option.disabled&&previous.value!==String(current))result[index]=option
 }
 return result
}

// A filter is useful when it can narrow the rows, including populated vs blank.
// Keep an active filter visible even when its current results have one value.
export function hasFilterChoices(rows=[],valueFor,active=''){
 if(active)return true
 const values=new Set(rows.map(row=>key(valueFor(row))))
 return values.size>1&&[...values].some(Boolean)
}
