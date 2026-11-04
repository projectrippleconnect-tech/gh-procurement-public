// Lightweight, offline typo tolerance for both General and Company catalogues.
// No external service, item mutation, or database-wide fuzzy queries are needed.
const aliases = Object.freeze({
  siment:'cement', simenti:'cement', cimenti:'cement', cementu:'cement',
  paip:'pipe', pype:'pipe', bata:'pipe',
  balb:'bulb', bulbe:'bulb',
  alumunium:'aluminium', aluminiyam:'aluminium',
  kambi:'steel', kaambi:'steel'
})

export function normalizeItemSearch(value){
 return String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
  .toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ')
}

// A single hardware item is often written as joined or separated words.
// Normalize only unambiguous compound names; retain original stored names.
export function canonicalItemSearch(value){
 return normalizeItemSearch(value)
  .replace(/\bpad\s*(?:lock|loc|lok)\b/g,'padlock')
  .replace(/\bscrew\s+driver\b/g,'screwdriver')
  .replace(/\bwash\s+basin\b/g,'washbasin')
}

export function searchWords(query,{expandAliases=false}={}){
 const words=canonicalItemSearch(query).split(' ').filter(Boolean)
 return expandAliases?words.map(word=>aliases[word]||word):words
}

// Restricted optimal-string-alignment distance (includes adjacent swaps).
function distanceWithin(a,b,max){
 const n=a.length,m=b.length
 if(Math.abs(n-m)>max)return max+1
 let previous2=null,previous=Array.from({length:m+1},(_,i)=>i)
 for(let i=1;i<=n;i++){
  const current=Array(m+1).fill(max+1)
  current[0]=i
  let rowMin=current[0]
  for(let j=Math.max(1,i-max);j<=Math.min(m,i+max);j++){
   const cost=a[i-1]===b[j-1]?0:1
   let v=Math.min(previous[j]+1,current[j-1]+1,previous[j-1]+cost)
   if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]&&previous2)v=Math.min(v,previous2[j-2]+1)
   current[j]=v
   if(v<rowMin)rowMin=v
  }
  if(rowMin>max)return max+1
  previous2=previous;previous=current
 }
 return previous[m]
}

function tokenDistance(word,token){
 if(/\d/.test(word))return token.startsWith(word)?0:Infinity
 if(token.includes(word))return 0
 if(word.length<4||token.length<3)return Infinity
 const max=word.length>=7?2:1
 if(token.length>word.length){
  // Also accept a misspelled prefix while the user is still typing.
  let best=max+1
  for(const size of [word.length-1,word.length,word.length+1]){
   if(size>=3&&size<=token.length)best=Math.min(best,distanceWithin(word,token.slice(0,size),max))
  }
  return best<=max?best:Infinity
 }
 const distance=distanceWithin(word,token,max)
 return distance<=max?distance:Infinity
}

export function fuzzyItemScore(row,query){
 const words=Array.isArray(query)?query:searchWords(query,{expandAliases:true})
 if(!words.length)return null
 const tokens=row.searchTokens||searchWords([row.item_code,row.description,row.brand,row.category,row.main_group,row.subgroup,row.size,row.uom,row.colour,row.variation].filter(Boolean).join(' '))
 const descriptionTokens=row.descriptionTokens||searchWords(row.description)
 const labelTokens=row.labelTokens||searchWords(row.searchLabel||row.description)
 let score=0, approximate=false
 for(const word of words){
  let best=Infinity
  for(const token of tokens){
   const distance=tokenDistance(word,token)
   if(distance===Infinity)continue
   const visible=descriptionTokens.includes(token)?0:labelTokens.includes(token)?3:7
   const cost=distance===0?visible:15+distance*3+visible
   if(cost<best)best=cost
   if(best===0)break
  }
  if(best===Infinity)return null
  approximate ||= best>=15
  score+=best
 }
 return {score,approximate}
}

export function isApproximateItemMatch(row,query){
 const words=searchWords(query)
 if(!words.length)return false
 const rawTokens=row.searchTokens||searchWords([row.item_code,row.description,row.brand,row.category,row.main_group,row.subgroup,row.size,row.uom,row.colour,row.variation].filter(Boolean).join(' '))
 return !words.every(word=>rawTokens.some(token=>/\d/.test(word)?token.startsWith(word):token.includes(word)))
}
