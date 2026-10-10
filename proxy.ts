import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { contentSecurityPolicy } from './lib/content-security-policy'

export function proxy(request: NextRequest) {
  const nonce = randomBytes(16).toString('base64')
  const policy = contentSecurityPolicy({ nonce, development: process.env.NODE_ENV === 'development' })
  const requestHeaders = new Headers(request.headers)
  // Overwrite client-supplied values before Next.js extracts the render nonce.
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: ['/((?!api(?:/|$)|_next/|.*\\.[^/]+$).*)'],
}
