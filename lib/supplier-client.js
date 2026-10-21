import {createClient} from '@supabase/supabase-js'
// Supplier bearer links never reuse a staff login session or parse auth redirects.
export const supplierClient=createClient(
 process.env.NEXT_PUBLIC_SUPABASE_URL||'https://huxhcjmcvlhblvpvrron.supabase.co',
 process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'sb_publishable__Z6JVArxsa4aCweBy7SDyw_O3pLIm42',
 {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}
)
