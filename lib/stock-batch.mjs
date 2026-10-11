export const MAX_STOCK_BATCH=1000
export function stockCountBatch(entry){
 const counted=Object.entries(entry).filter(([,value])=>value!==undefined&&value!=='')
 return {counted,checked:counted.slice(0,MAX_STOCK_BATCH),remaining:Math.max(0,counted.length-MAX_STOCK_BATCH)}
}
