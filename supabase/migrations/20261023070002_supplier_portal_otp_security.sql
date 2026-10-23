-- Coordinated release: deploy the server portal API before applying this migration.
-- Existing quotations are preserved; anonymous bearer-only read/write is removed.
begin;
create function private.proc_portal_phone_v1(p_phone text) returns text
language sql immutable set search_path='' as $$
 select case when v ~ '^07[0-9]{8}$' then '94'||substr(v,2)
 when v ~ '^947[0-9]{8}$' then v
 when v ~ '^00947[0-9]{8}$' then substr(v,3) else null end
 from (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') v) x
$$;
revoke all on function private.proc_portal_phone_v1(text) from public,anon,authenticated,service_role;

create table private.proc_portal_otp_limits(
 phone text primary key, window_at timestamptz not null, last_at timestamptz not null,
 sent integer not null check(sent between 1 and 5)
);
create table private.proc_portal_otp_challenges(
 id uuid primary key, link_id uuid not null unique references public.proc_supplier_portal_links(id) on delete cascade,
 token_hash text not null, phone text not null, code_hash text not null,
 expires_at timestamptz not null, attempts integer not null default 0 check(attempts between 0 and 5),
 delivered boolean not null default false, consumed boolean not null default false
);
create table private.proc_portal_otp_sessions(
 session_hash text primary key check(session_hash ~ '^[0-9a-f]{64}$'),
 link_id uuid not null references public.proc_supplier_portal_links(id) on delete cascade,
 token_hash text not null, phone text not null, expires_at timestamptz not null
);
create index proc_portal_otp_sessions_link_idx on private.proc_portal_otp_sessions(link_id);
alter table private.proc_portal_otp_limits enable row level security;
alter table private.proc_portal_otp_challenges enable row level security;
alter table private.proc_portal_otp_sessions enable row level security;
revoke all on private.proc_portal_otp_limits,private.proc_portal_otp_challenges,private.proc_portal_otp_sessions from public,anon,authenticated,service_role;

-- Only the trusted server can reserve a code; recipient comes from the database.
create function public.proc_portal_otp_request_v1(p_token text,p_phone text,p_challenge uuid,p_code_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a record; phone_v text; lim private.proc_portal_otp_limits; ts timestamptz:=clock_timestamp();
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_challenge is null or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 select l.*,s.active,private.proc_portal_phone_v1(coalesce(nullif(trim(s.whatsapp),''),s.phone)) phone,r.status rfq_status
 into a from public.proc_supplier_portal_links l join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_suppliers s on s.id=rs.supplier_id join public.proc_rfqs r on r.id=rs.rfq_id
 where l.token_hash=encode(extensions.digest(p_token,'sha256'),'hex') and l.revoked_at is null;
 phone_v:=private.proc_portal_phone_v1(p_phone);
 if a.id is null or not a.active or a.phone is null or phone_v is distinct from a.phone or ts<a.opens_at or ts>=a.closes_at
 or a.rfq_status not in ('draft','prepared','sent','partially_quoted','quoted') then return null; end if;
 -- One phone-wide lock serializes rate limits even across different invitations.
 perform pg_advisory_xact_lock(hashtextextended('portal-otp:'||phone_v,0));
 select * into lim from private.proc_portal_otp_limits where phone=phone_v for update;
 if found and (ts<lim.last_at+interval '60 seconds' or ts<lim.window_at+interval '1 hour' and lim.sent>=5) then
  return jsonb_build_object('limited',true);
 end if;
 insert into private.proc_portal_otp_limits values(phone_v,ts,ts,1)
 on conflict(phone) do update set last_at=ts,
 sent=case when ts>=private.proc_portal_otp_limits.window_at+interval '1 hour' then 1 else private.proc_portal_otp_limits.sent+1 end,
 window_at=case when ts>=private.proc_portal_otp_limits.window_at+interval '1 hour' then ts else private.proc_portal_otp_limits.window_at end;
 insert into private.proc_portal_otp_challenges(id,link_id,token_hash,phone,code_hash,expires_at)
 values(p_challenge,a.id,a.token_hash,phone_v,p_code_hash,least(ts+interval '5 minutes',a.closes_at))
 on conflict(link_id) do update set id=excluded.id,token_hash=excluded.token_hash,phone=excluded.phone,
 code_hash=excluded.code_hash,expires_at=excluded.expires_at,attempts=0,delivered=false,consumed=false;
 return jsonb_build_object('phone',phone_v,'expires_at',least(ts+interval '5 minutes',a.closes_at));
end $$;

create function public.proc_portal_otp_delivered_v1(p_challenge uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 update private.proc_portal_otp_challenges set delivered=true where id=p_challenge and not consumed and expires_at>clock_timestamp();
 return found;
end $$;

create function public.proc_portal_otp_verify_v1(p_token text,p_challenge uuid,p_code_hash text,p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.proc_portal_otp_challenges; a record; expiry timestamptz;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_session_hash is null or p_session_hash !~ '^[0-9a-f]{64}$' then return null; end if;
 select * into c from private.proc_portal_otp_challenges where id=p_challenge for update;
 if not found or c.consumed or not c.delivered or c.expires_at<=clock_timestamp() or c.attempts>=5
 or c.token_hash<>encode(extensions.digest(p_token,'sha256'),'hex') then return null; end if;
 -- Return instead of raising: failed attempts must persist across HTTP calls.
 update private.proc_portal_otp_challenges set attempts=attempts+1 where id=c.id;
 if c.code_hash is distinct from p_code_hash then return null; end if;
 select l.*,s.active,private.proc_portal_phone_v1(coalesce(nullif(trim(s.whatsapp),''),s.phone)) phone
 into a from public.proc_supplier_portal_links l join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_suppliers s on s.id=rs.supplier_id where l.id=c.link_id;
 if a.revoked_at is not null or not a.active or a.token_hash<>c.token_hash or a.phone is distinct from c.phone or a.closes_at<=clock_timestamp() then return null; end if;
 expiry:=least(clock_timestamp()+interval '2 hours',a.closes_at);
 update private.proc_portal_otp_challenges set consumed=true where id=c.id;
 delete from private.proc_portal_otp_sessions where link_id=c.link_id and expires_at<=clock_timestamp();
 insert into private.proc_portal_otp_sessions values(p_session_hash,c.link_id,c.token_hash,c.phone,expiry);
 return jsonb_build_object('expires_at',expiry);
end $$;

-- Verification and the read/write run in one transaction. Old bearer-only RPCs
-- remain callable only by the server and database owner, never by browser roles.
create function public.proc_portal_session_v1(p_token text,p_session_hash text,p_action text,p_response jsonb default null,p_expected_revision integer default null,p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare valid boolean;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 select true into valid from private.proc_portal_otp_sessions v
 join public.proc_supplier_portal_links l on l.id=v.link_id
 join public.proc_rfq_suppliers rs on rs.id=l.rfq_supplier_id
 join public.proc_suppliers s on s.id=rs.supplier_id
 where v.session_hash=p_session_hash and v.token_hash=encode(extensions.digest(p_token,'sha256'),'hex')
 and l.token_hash=v.token_hash and l.revoked_at is null and s.active and l.closes_at>clock_timestamp()
 and v.expires_at>clock_timestamp() and v.phone=private.proc_portal_phone_v1(coalesce(nullif(trim(s.whatsapp),''),s.phone));
 if not coalesce(valid,false) then raise exception 'Phone verification required' using errcode='42501'; end if;
 if p_action='read' then return public.proc_portal_read_v1(p_token); end if;
 if p_action='submit' then return public.proc_portal_submit_v1(p_token,p_response,p_expected_revision,p_confirm); end if;
 raise exception 'Invalid portal action';
end $$;
revoke all on function public.proc_portal_read_v1(text),public.proc_portal_submit_v1(text,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.proc_portal_read_v1(text),public.proc_portal_submit_v1(text,jsonb,integer,boolean) to service_role;
revoke all on function public.proc_portal_otp_request_v1(text,text,uuid,text),public.proc_portal_otp_delivered_v1(uuid),public.proc_portal_otp_verify_v1(text,uuid,text,text),public.proc_portal_session_v1(text,text,text,jsonb,integer,boolean) from public,anon,authenticated;
grant execute on function public.proc_portal_otp_request_v1(text,text,uuid,text),public.proc_portal_otp_delivered_v1(uuid),public.proc_portal_otp_verify_v1(text,uuid,text,text),public.proc_portal_session_v1(text,text,text,jsonb,integer,boolean) to service_role;

create table private.proc_supplier_document_settings(
 singleton boolean primary key default true check(singleton),templates jsonb not null default '{}',
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now()
);
alter table private.proc_supplier_document_settings enable row level security;
revoke all on private.proc_supplier_document_settings from public,anon,authenticated,service_role;
insert into private.proc_supplier_document_settings(singleton) values(true);
create function public.proc_supplier_document_settings_v1(p_templates jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t jsonb; k text; n integer;
begin
 if coalesce(auth.role(),'')='service_role' then
  if p_templates is not null then raise exception 'Staff editor required' using errcode='42501'; end if;
 else
  perform private.proc_portal_require_staff('procurement.rfq.manage');
 end if;
 if p_templates is not null then
  if jsonb_typeof(p_templates)<>'object' or octet_length(p_templates::text)>10000 then raise exception 'Invalid templates'; end if;
  for k in select jsonb_object_keys(p_templates) loop
   if k not in ('po','rfq') then raise exception 'Invalid document type'; end if;
  end loop;
  for t in select value from jsonb_each(p_templates) loop
   if jsonb_typeof(t)<>'object' then raise exception 'Invalid template'; end if;
   for k,n in select * from (values('name',80),('title',60),('note',300),('caption',2000)) x(k,n) loop
    if t?k and (jsonb_typeof(t->k)<>'string' or length(t->>k)>n) then raise exception 'Invalid template field %',k; end if;
   end loop;
  end loop;
  update private.proc_supplier_document_settings set templates=p_templates,updated_by=auth.uid(),updated_at=clock_timestamp();
 end if;
 return (select templates from private.proc_supplier_document_settings where singleton);
end $$;
revoke all on function public.proc_supplier_document_settings_v1(jsonb) from public,anon;
grant execute on function public.proc_supplier_document_settings_v1(jsonb) to authenticated,service_role;

-- Include branding in the approval hash. Changing the header or caption after
-- approval invalidates an unclaimed dispatch instead of silently changing it.
alter function private.proc_portal_po_snapshot(uuid) rename to proc_portal_po_snapshot_before_branding_v1;
create function private.proc_portal_po_snapshot(p_po_id uuid) returns jsonb
language sql stable set search_path='' as $$
 select private.proc_portal_po_snapshot_before_branding_v1(p_po_id)||jsonb_build_object('document_template',
  coalesce((select templates->'po' from private.proc_supplier_document_settings where singleton),'{}'::jsonb))
$$;
revoke all on function private.proc_portal_po_snapshot(uuid),private.proc_portal_po_snapshot_before_branding_v1(uuid) from public,anon,authenticated,service_role;
commit;
