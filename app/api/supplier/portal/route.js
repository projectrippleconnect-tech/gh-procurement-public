import {supplierPortalRequest} from '@/lib/supplier-otp.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request){return supplierPortalRequest(request)}
