-- GH Procurement private staff WhatsApp archive (additive; disabled until group verification).
-- One immutable send attempt per accepted supplier dispatch. Never retry unknown status blindly.
create table if not exists public.proc_whatsapp_private_group_copies (
  id uuid primary key default gen_random_uuid(),
  rfq_dispatch_id uuid unique references public.proc_whatsapp_rfq_dispatches(id),
  po_dispatch_id uuid unique references public.proc_whatsapp_po_dispatches(id),
  created_by uuid not null references auth.users(id),
  group_chat_id text not null,
  gateway_session text not null,
  image_sha256 text not null,
  caption text not null,
  status text not null default 'sending' check (status in ('sending','accepted','failed','unknown')),
  message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proc_private_copy_one_source check (num_nonnulls(rfq_dispatch_id,po_dispatch_id)=1)
);
create index if not exists proc_whatsapp_private_group_copies_created_idx
  on public.proc_whatsapp_private_group_copies(created_at desc);
alter table public.proc_whatsapp_private_group_copies enable row level security;
revoke all on public.proc_whatsapp_private_group_copies from public,anon,authenticated;
grant select on public.proc_whatsapp_private_group_copies to authenticated;
drop policy if exists proc_whatsapp_private_group_copies_view on public.proc_whatsapp_private_group_copies;
create policy proc_whatsapp_private_group_copies_view on public.proc_whatsapp_private_group_copies
  for select to authenticated
  using (private.proc_is_role(array['admin','procurement']) and (
    private.proc_has_permission('procurement.rfq.view') or private.proc_has_permission('procurement.orders.view')
  ));

create or replace function private.proc_whatsapp_claim_private_group_copy(
  p_kind text,p_supplier_dispatch_id uuid,p_group_id text,p_session text,p_image_sha256 text,p_caption text
) returns uuid language plpgsql security definer set search_path='' as $$
declare
 v_id uuid;v_source public.proc_whatsapp_rfq_dispatches%rowtype;v_po public.proc_whatsapp_po_dispatches%rowtype;
begin
 if auth.uid() is null or not private.proc_is_role(array['admin','procurement']) then
  raise exception 'Unauthorized private group archive';
 end if;
 if p_kind not in ('rfq','po') or p_supplier_dispatch_id is null
  or p_group_id !~ '^[0-9][0-9-]{5,48}@g\\.us$'
  or p_session !~ '^[A-Za-z0-9_-]{1,50}$'
  or p_image_sha256 !~ '^[a-f0-9]{64}$'
  or p_caption is null or length(trim(p_caption))=0 or length(p_caption)>2000 then
  raise exception 'Invalid private group archive input';
 end if;
 if p_kind='rfq' then
  if not private.proc_has_permission('procurement.rfq.manage') then raise exception 'RFQ send permission required';end if;
  select * into v_source from public.proc_whatsapp_rfq_dispatches where id=p_supplier_dispatch_id and sent_by=auth.uid() and status='accepted';
  if not found or v_source.image_sha256 is distinct from p_image_sha256 or v_source.gateway_session is distinct from p_session then
   raise exception 'Only an accepted, same-image supplier RFQ dispatch may be archived';
  end if;
  insert into public.proc_whatsapp_private_group_copies(rfq_dispatch_id,created_by,group_chat_id,gateway_session,image_sha256,caption)
   values (p_supplier_dispatch_id,auth.uid(),p_group_id,p_session,p_image_sha256,p_caption) returning id into v_id;
 else
  if not private.proc_has_permission('procurement.orders.edit') then raise exception 'PO send permission required';end if;
  select * into v_po from public.proc_whatsapp_po_dispatches where id=p_supplier_dispatch_id and sent_by=auth.uid() and status='accepted';
  if not found or v_po.image_sha256 is distinct from p_image_sha256 or v_po.gateway_session is distinct from p_session then
   raise exception 'Only an accepted, same-image supplier PO dispatch may be archived';
  end if;
  insert into public.proc_whatsapp_private_group_copies(po_dispatch_id,created_by,group_chat_id,gateway_session,image_sha256,caption)
   values (p_supplier_dispatch_id,auth.uid(),p_group_id,p_session,p_image_sha256,p_caption) returning id into v_id;
 end if;
 return v_id;
end $$;
create or replace function public.proc_whatsapp_claim_private_group_copy(
 p_kind text,p_supplier_dispatch_id uuid,p_group_id text,p_session text,p_image_sha256 text,p_caption text
) returns uuid language sql security invoker set search_path='' as $$
 select private.proc_whatsapp_claim_private_group_copy(p_kind,p_supplier_dispatch_id,p_group_id,p_session,p_image_sha256,p_caption)
$$;

create or replace function private.proc_whatsapp_finish_private_group_copy(
 p_id uuid,p_status text,p_message_id text,p_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.proc_is_role(array['admin','procurement']) then
  raise exception 'Unauthorized private archive status change';
 end if;
 if p_status not in ('accepted','failed','unknown')then raise exception 'Invalid private archive status';end if;
 update public.proc_whatsapp_private_group_copies set status=p_status,message_id=left(p_message_id,200),
 last_error=left(p_error,1000),updated_at=now()
 where id=p_id and created_by=auth.uid() and status='sending';
 return found;
end $$;
create or replace function public.proc_whatsapp_finish_private_group_copy(
 p_id uuid,p_status text,p_message_id text,p_error text
) returns boolean language sql security invoker set search_path='' as $$
 select private.proc_whatsapp_finish_private_group_copy(p_id,p_status,p_message_id,p_error)
$$;
revoke all on function
 private.proc_whatsapp_claim_private_group_copy(text,uuid,text,text,text,text),
 public.proc_whatsapp_claim_private_group_copy(text,uuid,text,text,text,text),
 private.proc_whatsapp_finish_private_group_copy(uuid,text,text,text),
 public.proc_whatsapp_finish_private_group_copy(uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function
 public.proc_whatsapp_claim_private_group_copy(text,uuid,text,text,text,text),
 public.proc_whatsapp_finish_private_group_copy(uuid,text,text,text)
 to authenticated;
