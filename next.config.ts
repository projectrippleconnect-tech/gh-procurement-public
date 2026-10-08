import type { NextConfig } from 'next'

// Non-production Cloudflare Pages static-export proof of concept.
// All runtime data access remains in the browser via Supabase.
// Cloudflare Pages serves the headers declared in public/_headers.
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  trailingSlash: true,
}

export default nextConfig
