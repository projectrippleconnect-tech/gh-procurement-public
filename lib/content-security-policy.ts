type PolicyOptions = { nonce?: string; development?: boolean }

export function contentSecurityPolicy({ nonce, development = false }: PolicyOptions = {}) {
  if (nonce && !/^[A-Za-z0-9+/_=-]+$/.test(nonce)) throw new Error('Invalid CSP nonce')
  const scripts = ["'self'", "'wasm-unsafe-eval'"]
  if (nonce) scripts.push(`'nonce-${nonce}'`, "'strict-dynamic'")
  if (development) scripts.push("'unsafe-eval'")
  return [
    "default-src 'self'",
    `script-src ${scripts.join(' ')}`,
    "worker-src 'self' blob:",
    // Existing React controls and document previews use inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://tessdata.projectnaptha.com",
    "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'",
    "form-action 'self'", "upgrade-insecure-requests",
  ].join('; ')
}
