import {NextResponse} from 'next/server'
// Fallback when an installed app has not activated the local share receiver.
// Never parse, log, persist or forward contact content on the server.
export async function POST(request:Request){
 return NextResponse.redirect(new URL('/share/contact?error=not-ready',request.url),303)
}
