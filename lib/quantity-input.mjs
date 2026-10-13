// Keep decimal editing states while removing redundant leading zeroes.
// Return null for malformed input so existing valid values are never silently reinterpreted.
export function normalizeQuantityInput(value){
 const text=String(value??'').trim()
 if(text==='')return ''
 if(!/^\d*(?:\.\d*)?$/.test(text))return null
 if(text==='.')return '.'
 const [whole,fraction]=text.split('.')
 const integer=(whole||'0').replace(/^0+(?=\d)/,'')
 return fraction===undefined?integer:integer+'.'+fraction
}
export function isQuantityInput(value){
 const text=normalizeQuantityInput(value)
 return text!==null&&text!==''&&text!=='.'&&Number.isFinite(Number(text))
}
export function normalizeQuantityDraft(entry={}){
 return Object.fromEntries(Object.entries(entry).map(([key,value])=>[key,value===undefined?value:normalizeQuantityInput(value)??value]))
}
