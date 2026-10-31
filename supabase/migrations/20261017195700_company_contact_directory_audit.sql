-- Retain an audit trail of company contact directory changes.
do $audit$
begin
 if not exists (
   select 1 from pg_trigger
   where tgname='trg_proc_company_directory_audit'
     and tgrelid='public.proc_company_contact_directory'::regclass
     and not tgisinternal
 ) then
   create trigger trg_proc_company_directory_audit
   after insert or update or delete on public.proc_company_contact_directory
   for each row execute function private.proc_audit_row();
 end if;
end $audit$;