-- Private WAHA gateway dispatch audit: no client may create/alter a dispatch.
-- Apply via the existing controlled Supabase migration process before enabling gateway.
create table if not exists public.proc_whatsapp_rfq_dispatches (
 id uuid primary key default gen_random_uuid(),
 rfq_id uuid not null references public.proc_rfqs(id),
 supplier_id uuid not null references public.proc_suppliers(id),
 sent_by uuid not null references auth.users(id),
 gateway_session text not null,
 status text not null check (status in ('sending','accepted','failed','unknown')),
 message_id text,
 image_sha256 text not null,
 caption text not null,
 last_error text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint proc_whatsapp_rfq_one_attempt unique (rfq_id,supplier_id)
);
create index if not exists proc_whatsapp_rfq_dispatches_created_at_idx
 on public.proc_whatsapp_rfq_dispatches (created_at desc);
alter table public.proc_whatsapp_rfq_dispatches enable row level security;
revoke insert,update,delete on public.proc_whatsapp_rfq_dispatches from public,anon,authenticated;
grant select on public.proc_whatsapp_rfq_dispatches to authenticated;
drop policy if exists proc_whatsapp_rfq_dispatches_read on public.proc_whatsapp_rfq_dispatches;
create policy proc_whatsapp_rfq_dispatches_read on public.proc_whatsapp_rfq_dispatches
 for select to authenticated
 using (private.proc_has_permission('procurement.rfq.view'));
-- Service-role-only writes enforce atomic first-send claims and prevent browser spoofing.
-- A failed/unknown send must be investigated; never auto-retry a message.
