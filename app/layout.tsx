import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import './globals.css'

export const metadata: Metadata = {
  title: 'GH Procurement',
  description: 'General Hardware procurement, supplier comparison, purchasing and receiving control',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GH Procurement', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#0b1220' }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Each HTML response needs the nonce generated for its incoming request.
  await connection()
  return <html lang="en"><body>{children}</body></html>
}
