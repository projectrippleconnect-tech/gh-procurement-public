import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://huxhcjmcvlhblvpvrron.supabase.co'
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable__Z6JVArxsa4aCweBy7SDyw_O3pLIm42'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
})
