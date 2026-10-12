// Preserve decimal precision and partially typed values while removing
// redundant integer zeros (05 → 5, 000.50 → 0.50).
export function normalizePriceInput(value){
 return String(value??'').replace(/^0+(?=\d)/,'')
}
