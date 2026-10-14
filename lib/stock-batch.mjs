export const MAX_STOCK_BATCH=1000

// A sufficient-stock check records a verified condition, not a guessed physical count.
export function stockCountBatch(entry,sufficient={}){
 const counted=Object.entries(entry).filter(([id,value])=>!sufficient[id]&&value!==undefined&&value!=='')
 const marked=Object.entries(sufficient).filter(([,checked])=>checked===true).map(([id])=>[id,null])
 const pending=[...counted,...marked]
 return {counted,checked:pending.slice(0,MAX_STOCK_BATCH),remaining:Math.max(0,pending.length-MAX_STOCK_BATCH)}
}
