/** Canonical Sri Lankan WhatsApp mobile formatting; leave the editing input untouched. */
export function normalizeCompanyMobile(value) {
  const digits=String(value??'').replace(/\D/g,'')
  if (/^07\d{8}$/.test(digits)) return '+94'+digits.slice(1)
  if (/^947\d{8}$/.test(digits)) return '+'+digits
  return null
}
export function isCompleteCompanyContact(name,phone) {
  return Boolean(String(name??'').trim()&&normalizeCompanyMobile(phone))
}
