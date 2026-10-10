-- Additive PO dispatch audit. Existing order data and permissions remain unchanged.
create table public.proc_whatsapp_po_dispatches (
 id uuid primary key default gen_random_uuid(),
 po_id uuid not null unique references public.proc_purchase_orders(id),
 supplier_id uuid not null references public.proc_suppliers(id),
 sent_by uuid not null references auth.users(id),
 gateway_session text not null,
 status text not null check(status in ('sending','accepted','failed','unknown')),
 message_id text,image_sha256 text not null,caption text not null,last_error text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index proc_whatsapp_po_supplier_idx on public.proc_whatsapp_po_dispatches(supplier_id);
create index proc_whatsapp_po_sender_idx on public.proc_whatsapp_po_dispatches(sent_by);
alter table public.proc_whatsapp_po_dispatches enable row level security;
revoke all on public.proc_whatsapp_po_dispatches from public,anon,authenticated;
grant select on public.proc_whatsapp_po_dispatches to authenticated;
create policy proc_whatsapp_po_read on public.proc_whatsapp_po_dispatches for select to authenticated using (private.proc_has_permission('procurement.orders.view'));
create function private.proc_whatsapp_claim_po_dispatch(p_po_id uuid,p_session text,p_image_sha256 text,p_caption text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_supplier uuid;
begin
 if auth.uid() is null or not private.proc_is_role(array['admin','procurement']) or not private.proc_has_permission('procurement.orders.edit') then raise exception 'Unauthorized WhatsApp PO dispatch';end if;
 if p_image_sha256 is null or p_image_sha256 !~ '^[a-f0-9]{64}$' or p_session is null or p_session !~ '^[A-Za-z0-9_-]{1,50}$' or p_caption is null or length(trim(p_caption))=0 or length(p_caption)>2000 then raise exception 'Invalid dispatch fields';end if;
 select p.supplier_id into v_supplier from public.proc_purchase_orders p join public.proc_suppliers s on s.id=p.supplier_id where p.id=p_po_id and p.status='approved' and s.active for share of p,s;
 if v_supplier is null then raise exception 'Only approved orders with active suppliers can be dispatched';end if;
 insert into public.proc_whatsapp_po_dispatches(po_id,supplier_id,sent_by,gateway_session,status,image_sha256,caption)values(p_po_id,v_supplier,auth.uid(),p_session,'sending',p_image_sha256,p_caption)returning id into v_id;
 return v_id;
end $$;
create function public.proc_whatsapp_claim_po_dispatch(p_po_id uuid,p_session text,p_image_sha256 text,p_caption text)
returns uuid language sql security invoker set search_path='' as $$select private.proc_whatsapp_claim_po_dispatch(p_po_id,p_session,p_image_sha256,p_caption)$$;
create function private.proc_whatsapp_finish_po_dispatch(p_id uuid,p_status text,p_message_id text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not private.proc_is_role(array['admin','procurement']) or not private.proc_has_permission('procurement.orders.edit')then raise exception 'Unauthorized WhatsApp PO dispatch';end if;
 if p_status is null or p_status not in ('accepted','failed','unknown')then raise exception 'Invalid dispatch status';end if;
 update public.proc_whatsapp_po_dispatches set status=p_status,message_id=left(p_message_id,500),last_error=left(p_error,1000),updated_at=now() where id=p_id and sent_by=auth.uid() and status='sending';return found;
end $$;
create function public.proc_whatsapp_finish_po_dispatch(p_id uuid,p_status text,p_message_id text,p_error text)
returns boolean language sql security invoker set search_path='' as $$select private.proc_whatsapp_finish_po_dispatch(p_id,p_status,p_message_id,p_error)$$;
revoke all on function private.proc_whatsapp_claim_po_dispatch(uuid,text,text,text),private.proc_whatsapp_finish_po_dispatch(uuid,text,text,text),public.proc_whatsapp_claim_po_dispatch(uuid,text,text,text),public.proc_whatsapp_finish_po_dispatch(uuid,text,text,text) from public,anon,authenticated;
grant execute on function private.proc_whatsapp_claim_po_dispatch(uuid,text,text,text),private.proc_whatsapp_finish_po_dispatch(uuid,text,text,text),public.proc_whatsapp_claim_po_dispatch(uuid,text,text,text),public.proc_whatsapp_finish_po_dispatch(uuid,text,text,text) to authenticated;
