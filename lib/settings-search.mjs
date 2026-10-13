export function normalizeSettingsSearch(value){
 return String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim()
}
export function settingsMatch(text,query){
 const searchable=normalizeSettingsSearch(text)
 return normalizeSettingsSearch(query).split(' ').filter(Boolean).every(word=>searchable.includes(word))
}
