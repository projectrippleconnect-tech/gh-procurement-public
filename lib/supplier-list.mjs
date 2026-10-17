// Keep Review supplier choices unique and predictable across search and kind filters.
export function supplierListRows(suppliers = [], kind = 'general', search = '') {
 const seen = new Set()
 const query = String(search || '').trim().toLocaleLowerCase()
 return (suppliers || []).filter(s => {
  if (!s?.id || seen.has(s.id)) return false
  seen.add(s.id)
  if (kind !== 'all' && (s.supplier_kind || 'general') !== kind) return false
  return String(s.name || '').toLocaleLowerCase().includes(query)
 }).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'en', {sensitivity:'base', numeric:true}))
}
