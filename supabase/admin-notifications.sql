-- Additive admin alerts; no historical submissions are replayed.
create extension if not exists pg_net with schema extensions;
create table public.proc_admin_notifications (
 id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.proc_profiles(id) on delete cascade,
 event_key text not null, kind text not null, title text not null, body text not null, target_view text not null,
 record_id uuid, created_at timestamptz not null default now(), read_at timestamptz,
 unique(recipient_id,event_key)
);
create index on public.proc_admin_notifications(recipient_id,created_at desc);
create table public.proc_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.proc_profiles(id) on delete cascade,
 endpoint text not null unique, subscription jsonb not null, created_at timestamptz not null default now()
);
create table public.proc_push_deliveries (
 notification_id uuid references public.proc_admin_notifications(id) on delete cascade,
 subscription_id uuid references public.proc_push_subscriptions(id) on delete cascade,
 attempts int not null default 0, next_attempt_at timestamptz not null default now(), sent_at timestamptz, last_error text,
 primary key(notification_id,subscription_id)
);
create table public.proc_push_config (id boolean primary key default true check(id), worker_secret text not null, vapid_public text, vapid_private text);
alter table public.proc_admin_notifications enable row level security;
alter table public.proc_push_subscriptions enable row level security;
alter table public.proc_push_deliveries enable row level security;
alter table public.proc_push_config enable row level security;
revoke all on public.proc_admin_notifications,public.proc_push_subscriptions,public.proc_push_deliveries,public.proc_push_config from anon,authenticated;
grant select on public.proc_admin_notifications to authenticated;
grant update(read_at) on public.proc_admin_notifications to authenticated;
grant select,insert,delete on public.proc_push_subscriptions to authenticated;
grant all on public.proc_admin_notifications,public.proc_push_subscriptions,public.proc_push_deliveries,public.proc_push_config to service_role;
create policy admin_alert_read on public.proc_admin_notifications for select to authenticated using(recipient_id=auth.uid() and private.proc_current_role()='admin');
create policy admin_alert_seen on public.proc_admin_notifications for update to authenticated using(recipient_id=auth.uid() and private.proc_current_role()='admin') with check(recipient_id=auth.uid() and private.proc_current_role()='admin');
create policy admin_push_read on public.proc_push_subscriptions for select to authenticated using(user_id=auth.uid() and private.proc_current_role()='admin');
create policy admin_push_add on public.proc_push_subscriptions for insert to authenticated with check(user_id=auth.uid() and private.proc_current_role()='admin' and subscription->>'endpoint'=endpoint and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/');
create policy admin_push_remove on public.proc_push_subscriptions for delete to authenticated using(user_id=auth.uid());
create or replace function private.proc_admin_submission_alert() returns trigger language plpgsql security definer set search_path='' as $$
declare k text; title_v text; body_v text; view_v text;
begin
 if tg_op='UPDATE' and old.status=new.status then return new;end if;
 if tg_table_name='proc_stock_counts' then
  if new.status<>'submitted' then return new;end if;
  k:='stock:'||new.id;title_v:='Stock submitted';view_v:='stock';
  select coalesce(display_name,'Stock handler') into body_v from public.proc_profiles where id=new.counted_by;
  body_v:=coalesce(body_v,'Stock handler')||' submitted '||new.count_no||coalesce(' · '||nullif(new.category,''),'');
 else
  if new.status not in ('pending_approval','sent') and not (tg_op='INSERT' and new.status='approved') then return new;end if;
  k:='po:'||new.id||':'||case when new.status='approved' then 'pending_approval' else new.status end;view_v:='po';
  title_v:=case when new.status='sent' then 'Supply order sent' else 'Supply order submitted' end;
  select coalesce(name,'Supplier') into body_v from public.proc_suppliers where id=new.supplier_id;
  body_v:=new.po_no||' · '||coalesce(body_v,'Supplier')||case when new.status='pending_approval' then ' · awaiting approval' else '' end;
 end if;
 insert into public.proc_admin_notifications(recipient_id,event_key,kind,title,body,target_view,record_id)
 select p.id,k,tg_table_name,title_v,body_v,view_v,new.id from public.proc_profiles p
 join public.proc_roles r on r.role_key=p.role_key and r.enabled
 where p.active and p.deleted_at is null and p.role='admin'
 on conflict(recipient_id,event_key) do nothing;
 return new;
end $$;
revoke all on function private.proc_admin_submission_alert() from public,anon,authenticated;
create trigger proc_stock_admin_alert after insert or update of status on public.proc_stock_counts for each row execute function private.proc_admin_submission_alert();
create trigger proc_po_admin_alert after insert or update of status on public.proc_purchase_orders for each row execute function private.proc_admin_submission_alert();
-- Existing Vault protects the worker credential; no secret is embedded in cron text.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'proc_admin_push_worker');
insert into public.proc_push_config(id,worker_secret) select true,decrypted_secret from vault.decrypted_secrets where name='proc_admin_push_worker';
select cron.schedule('gh-procurement-admin-push','* * * * *',$job$
select net.http_post(url:='https://huxhcjmcvlhblvpvrron.supabase.co/functions/v1/proc-admin-push',headers:=jsonb_build_object('Content-Type','application/json','x-worker-secret',(select decrypted_secret from vault.decrypted_secrets where name='proc_admin_push_worker')),body:='{}'::jsonb);
$job$);
