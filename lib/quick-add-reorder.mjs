// Mirrors the database stock-level triggers. Company lists always use 50%.
export function quickAddReorderLevel(maxStock,movement='NORMAL',company=false){
 const n=Number(maxStock)
 if(maxStock===''||maxStock===null||maxStock===undefined||!Number.isFinite(n)||n<0)return null
 return company?n*.5:Math.ceil(n*(movement==='FAST'?.5:movement==='SLOW'?.25:1/3))
}
