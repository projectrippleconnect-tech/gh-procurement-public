// Urgent actions + user invites release marker: 2026-10-05
import ProcurementApp from '@/components/procurement-app'
import {DangerConfirmationProvider} from '@/components/danger-confirmation'
export default function Page() { return <DangerConfirmationProvider><ProcurementApp /></DangerConfirmationProvider> }
