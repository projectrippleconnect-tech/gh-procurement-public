-- GH Procurement staff-only WhatsApp mirror (additive, initially DISABLED).
-- Every original supplier send stays authoritative; one audit attempt per source/page.
-- No browser insert/update; no automatic retry of failed or uncertain WhatsApp calls.
create table if not exists public.proc_whatsapp_private_group_copies(
 id uuid primary key default gen_random_uuid(),
 source_kind text not null check(source_kind in ('rfq','po','company_rfq','company_po')),
 source_id uuid not null,
 page_number integer not null check(page_number between 1 and 100),
 created_by uuid not null references auth.users(id),
 group_chat_id text not null,
 gateway_session text not null,
 image_sha256 text not null,
 caption text not null,
 status text not null default 'sending' check(status in ('sending','accepted','failed','unknown')),
 message_id text,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 constraint proc_private_group_copy_one_attempt unique(source_kind,source_id,page_number)
);
create index if not exists proc_private_group_copies_time_idx on public.proc_whatsapp_private_group_copies(created_at desc);
alter table public.proc_whatsapp_private_group_copies enable row level security;
revoke all on public.proc_whatsapp_private_group_copies from public,anon,authenticated;
grant select on public.proc_whatsapp_private_group_copies to authenticated;
drop policy if exists proc_private_group_copies_staff_view on public.proc_whatsapp_private_group_copies;
create policy proc_private_group_copies_staff_view on public.proc_whatsapp_private_group_copies
 for select to authenticated using (
 private.proc_is_role(array['admin','procurement']) and (
 private.proc_has_permission('procurement.rfq.view') or private.proc_has_permission('procurement.orders.view')
 ));

create or replace function private.proc_whatsapp_claim_private_group_copy(
 p_kind text,p_source_id uuid,p_page integer,p_group_id text,p_session text,p_image_sha256 text,p_caption text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null then raise exception 'Login required for private WhatsApp archive';end if;
 perform private.proc_assert_access();
 if p_kind in ('rfq','po') and not private.proc_is_role(array['admin','procurement']) then
  raise exception 'Procurement operator required for manual WhatsApp archive';
 end if;
 if p_kind in ('company_rfq','company_po') and not (
   private.proc_has_permission('company_lists.view') and
   (private.proc_has_permission('stock.count.enter') or private.proc_has_permission('company_lists.manage'))
 ) then raise exception 'Company queue permission required for WhatsApp archive'; end if;
 if p_kind is null or p_kind not in ('rfq','po','company_rfq','company_po')
  or p_source_id is null or p_page is null or p_page not between 1 and 100
  or p_group_id is null or p_group_id !~ '^[0-9][0-9-]{5,48}@g[.]us$'
  or p_session is null or p_session !~ '^[A-Za-z0-9_-]{1,50}$'
  or p_image_sha256 is null or p_image_sha256 !~ '^[a-f0-9]{64}$'
  or p_caption is null or length(trim(p_caption))=0 or length(p_caption)>2000
 then raise exception 'Invalid private group audit fields'; end if;
 if p_kind='rfq' then
  if not private.proc_has_permission('procurement.rfq.manage') then raise exception 'RFQ permission required';end if;
  if p_page<>1 or not exists(
   select 1 from public.proc_whatsapp_rfq_dispatches d
   where d.id=p_source_id and d.sent_by=auth.uid() and d.status='accepted'
    and d.gateway_session=p_session and d.image_sha256=p_image_sha256
  ) then raise exception 'Supplier RFQ must be accepted with the exact image before archiving';end if;
 elsif p_kind='po' then
  if not private.proc_has_permission('procurement.orders.edit') then raise exception 'PO permission required';end if;
  if p_page<>1 or not exists(
   select 1 from public.proc_whatsapp_po_dispatches d
   where d.id=p_source_id and d.sent_by=auth.uid() and d.status='accepted'
    and d.gateway_session=p_session and d.image_sha256=p_image_sha256
  ) then raise exception 'Supplier PO must be accepted with the exact image before archiving';end if;
 elsif p_kind='company_rfq' then
  if not private.proc_has_permission('company_lists.view') then raise exception 'Company RFQ permission required';end if;
  if not exists(
   select 1 from public.proc_company_rfq_queue q
   join public.proc_whatsapp_rfq_dispatches d on d.id=q.dispatch_id
   where q.id=p_source_id and q.claimed_by=auth.uid() and q.status='accepted'
     and d.status='accepted' and d.gateway_session=p_session
  ) then raise exception 'Automatic RFQ must be accepted before archiving';end if;
 elsif p_kind='company_po' then
  if not private.proc_has_permission('company_lists.view') then raise exception 'Company PO permission required';end if;
  if not exists(
   select 1 from public.proc_company_dispatch_queue q
   where q.id=p_source_id and q.claimed_by=auth.uid() and q.status='accepted'
  ) then raise exception 'Automatic PO must be accepted before archiving';end if;
 end if;
 insert into public.proc_whatsapp_private_group_copies(source_kind,source_id,page_number,created_by,group_chat_id,gateway_session,image_sha256,caption)
  values(p_kind,p_source_id,p_page,auth.uid(),p_group_id,p_session,p_image_sha256,p_caption)
  returning id into v_id;
 return v_id;
end $$;
create or replace function public.proc_whatsapp_claim_private_group_copy(
 p_kind text,p_source_id uuid,p_page integer,p_group_id text,p_session text,p_image_sha256 text,p_caption text
) returns uuid language sql security invoker set search_path='' as $$
 select private.proc_whatsapp_claim_private_group_copy(p_kind,p_source_id,p_page,p_group_id,p_session,p_image_sha256,p_caption)
$$;

create or replace function private.proc_whatsapp_finish_private_group_copy(
 p_id uuid,p_status text,p_message_id text,p_error text
) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Private WhatsApp audit status requires login';end if;
 perform private.proc_assert_access();
 if p_status is null or p_status not in ('accepted','failed','unknown') then
  raise exception 'Invalid private group status';
 end if;
 update public.proc_whatsapp_private_group_copies set
  status=p_status,message_id=left(p_message_id,200),last_error=left(p_error,1000),updated_at=now()
  where id=p_id and created_by=auth.uid() and status='sending';
 return found;
end $$;
create or replace function public.proc_whatsapp_finish_private_group_copy(
 p_id uuid,p_status text,p_message_id text,p_error text
) returns boolean language sql security invoker set search_path='' as $$
 select private.proc_whatsapp_finish_private_group_copy(p_id,p_status,p_message_id,p_error)
$$;
revoke all on function
 private.proc_whatsapp_claim_private_group_copy(text,uuid,integer,text,text,text,text),
 public.proc_whatsapp_claim_private_group_copy(text,uuid,integer,text,text,text,text),
 private.proc_whatsapp_finish_private_group_copy(uuid,text,text,text),
 public.proc_whatsapp_finish_private_group_copy(uuid,text,text,text)
 from public,anon,authenticated;
grant execute on function
 public.proc_whatsapp_claim_private_group_copy(text,uuid,integer,text,text,text,text),
 public.proc_whatsapp_finish_private_group_copy(uuid,text,text,text)
 to authenticated;
