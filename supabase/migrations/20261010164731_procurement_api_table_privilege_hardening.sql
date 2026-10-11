-- RLS does not apply to TRUNCATE. Browser roles must never receive table-control
-- privileges. Scope this change to procurement; this database is shared.
do $hardening$
declare t record;
begin
  for t in
    select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
      and left(c.relname,5)='proc_'
  loop
    execute format('revoke truncate,references,trigger on table %I.%I from public,anon,authenticated',t.nspname,t.relname);
  end loop;
end $hardening$;

-- Preserve permission-filtered audit reads and the existing guarded dispatch RPCs.
-- Anonymous sessions have no reason to access procurement dispatch metadata.
revoke all on table public.proc_whatsapp_rfq_dispatches from public,anon,authenticated;
grant select on table public.proc_whatsapp_rfq_dispatches to authenticated;
