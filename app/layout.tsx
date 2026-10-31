import type { Metadata, Viewport } from 'next'
import { connection } from 'next/server'
import './globals.css'
import './appearance.css'
import {AppearanceBootstrap} from '@/components/appearance-controls'
import {LegacyContactShareCleanup} from '@/components/legacy-contact-share-cleanup'

export const metadata: Metadata = {
  title: 'GH Procurement',
  description: 'General Hardware procurement, supplier comparison, purchasing and receiving control',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'GH Procurement', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, interactiveWidget: 'resizes-content', viewportFit: 'cover', themeColor: '#0b1220' }

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Each HTML response needs the nonce generated for its incoming request.
  await connection()
  return <html lang="en"><body><LegacyContactShareCleanup/><AppearanceBootstrap/>{children}</body></html>
}
