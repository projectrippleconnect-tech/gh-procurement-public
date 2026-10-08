'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type HealthState =
  | { status: 'checking'; message: string }
  | { status: 'healthy' | 'unavailable'; message: string }

// This check runs in the browser, not on the Cloudflare edge.
// Uptime monitors fetching /health only see the pre-rendered page,
// so use browser synthetic monitoring for database connectivity.
export default function HealthPage() {
  const [health, setHealth] = useState<HealthState>({
    status: 'checking',
    message: 'Checking database connection from this browser…',
  })

  useEffect(() => {
    let active = true
    async function checkDatabase() {
      try {
        const { data, error } = await supabase.rpc('proc_healthcheck_v1')
        if (!active) return
        if (error) throw error
        const ready = data?.database === 'connected' && data?.schema_ready === true
        setHealth({
          status: ready ? 'healthy' : 'unavailable',
          message: ready ? 'Database connection and schema are ready.' : 'The database did not confirm readiness.',
        })
      } catch {
        if (active) setHealth({ status: 'unavailable', message: 'Database connectivity could not be verified.' })
      }
    }
    void checkDatabase()
    return () => { active = false }
  }, [])

  return (
    <main style={{ maxWidth: 620, margin: '64px auto', padding: '24px' }}>
      <h1>GH Procurement — Connection Check</h1>
      <p role="status" aria-live="polite">{health.message}</p>
      <p>Check status: <strong>{health.status}</strong></p>
      <p>This page checks Supabase from your browser and cannot replace independent server monitoring.</p>
      <a href="/">Return to Procurement</a>
    </main>
  )
}
