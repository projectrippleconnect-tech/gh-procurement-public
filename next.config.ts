import type { NextConfig } from 'next'
import { contentSecurityPolicy } from './lib/content-security-policy'

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Content-Security-Policy', value: contentSecurityPolicy({ development: process.env.NODE_ENV === 'development' }) },
]

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep repeated builds independent of the host's persisted Turbopack database.
  experimental: { turbopackFileSystemCacheForBuild: false },
  poweredByHeader: false,
  outputFileTracingIncludes: {'/api/company-items/orders':['./assets/fonts/**/*'],'/api/company-items/rfqs':['./assets/fonts/**/*'],'/api/supplier-portal/worker':['./assets/fonts/**/*']},
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      { source: '/supplier/:path*', headers: [
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'Cache-Control', value: 'private, no-store' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
      ] },
      { source: '/supplier-links', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' },{ key: 'Cache-Control', value: 'private, no-store' }] },
    ]
  },
}

export default nextConfig
