import {NextResponse} from 'next/server'
// Compatibility for stale installed share targets; never read/store the body.
export async function POST(request:Request){
 return NextResponse.redirect(new URL('/',request.url),303)
}
