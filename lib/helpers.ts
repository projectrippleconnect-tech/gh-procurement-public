export const money = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', maximumFractionDigits: 2 }).format(Number(n || 0))

export const qty = (n: number | string | null | undefined) =>
  new Intl.NumberFormat('en-LK', { maximumFractionDigits: 3 }).format(Number(n || 0))

export const stamp = () => {
  const d = new Date()
  const p = (v: number, l = 2) => String(v).padStart(l, '0')
  return `${String(d.getFullYear()).slice(-2)}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${p(d.getMilliseconds(),3)}`
}

export const downloadCsv = (filename: string, rows: Record<string, unknown>[]) => {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers.map(esc).join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}


export const itemTitle = (item: {description?: string | null; size?: string | null}) => {
  const description = String(item?.description || '').trim()
  const size = String(item?.size || '').trim()
  if (!size) return description
  if (description.toLowerCase().includes(size.toLowerCase())) return description
  return description ? `${description} · ${size}` : size
}



/**
 * Supplier contact input: default to +94 and remove the domestic trunk zero.
 * The +94 stays visible while typing, including after selecting/clearing input.
 * A clearly different international prefix is left unchanged for validation
 * rather than silently turning a foreign number into a Sri Lankan one.
 */
export const formatSriLankaSupplierPhoneInput = (value: string | null | undefined) => {
  const raw = String(value ?? '').trim()
  let digits = raw.replace(/\D/g, '')
  if (!digits || digits === '94') return '+94'
  if ((raw.startsWith('+') && !raw.startsWith('+94')) ||
      (digits.startsWith('00') && !digits.startsWith('0094'))) return raw

  if (digits.startsWith('0094')) digits = digits.slice(4)
  else if (digits.startsWith('94')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = digits.slice(1)
  return '+94' + digits.replace(/^0+/, '')
}

/** Normalize and validate a full Sri Lankan supplier contact before saving. */
export const toSriLankaSupplierPhone = (value: string | null | undefined) => {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '+94') return ''
  if ((raw.startsWith('+') && !raw.startsWith('+94')) ||
      (raw.startsWith('00') && !raw.startsWith('0094'))) return ''
  const formatted = formatSriLankaSupplierPhoneInput(raw)
  return /^\+94[1-9]\d{8}$/.test(formatted) ? formatted : ''
}

export const normalizeWhatsAppNumber = (
  value: string | number | null | undefined,
  defaultCountryCode = '94'
) => {
  let digits = String(value ?? '').trim().replace(/\D/g, '')
  const countryCode = String(defaultCountryCode || '94').replace(/\D/g, '')
  if (!digits || !countryCode) return ''

  // International dialling prefix -> E.164 digits only.
  if (digits.startsWith('00')) digits = digits.slice(2)

  // Keep numbers that are already in the configured country format.
  if (digits.startsWith(countryCode)) return /^\d{8,15}$/.test(digits) ? digits : ''

  // Sri Lankan/local style numbers such as 0779792078 -> 94779792078.
  if (digits.startsWith('0')) digits = countryCode + digits.slice(1)
  else if (countryCode === '94' && digits.length === 9 && digits.startsWith('7')) digits = countryCode + digits

  // Preserve other already-international numbers (for overseas suppliers).
  return /^\d{8,15}$/.test(digits) ? digits : ''
}

export const whatsappUrl = (
  value: string | number | null | undefined,
  message = '',
  defaultCountryCode = '94'
) => {
  const number = normalizeWhatsAppNumber(value, defaultCountryCode)
  if (!number) return ''
  return `https://wa.me/${number}${message ? '?text=' + encodeURIComponent(message) : ''}`
}
