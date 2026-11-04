-- Business revision conflicts must not use the retryable serialization SQLSTATE.
-- PostgREST 14 loops on custom 40001; PT409 returns an HTTP conflict immediately.
-- Change only the three existing Prices/directory entry points, including private
-- implementations where a permission-hardening wrapper moved the original body.
-- CREATE OR REPLACE retains ownership, ACLs, signatures and function settings.
begin;
do $migration$
declare f record; definition text;
begin
 for f in
  select p.oid from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in (
   'proc_save_quote_guarded_v1','proc_company_directory_update_contact','proc_company_directory_delete_contact'
  )
 loop
  definition:=pg_catalog.pg_get_functiondef(f.oid);
  if definition ~* $pattern$errcode\s*=\s*'40001'$pattern$ then
   execute pg_catalog.regexp_replace(definition,$pattern$errcode\s*=\s*'40001'$pattern$,$replacement$errcode='PT409'$replacement$,'gi');
  end if;
 end loop;
end $migration$;
commit;
