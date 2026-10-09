-- Fail closed for missing/inactive profiles without changing valid roles or grants.
do $migration$
declare f record; revised text;
begin
 for f in
  select p.oid, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname like 'proc_%'
    and p.prokind='f' and p.prolang=(select oid from pg_language where lanname='plpgsql')
 loop
  revised:=regexp_replace(f.definition,'if caller_role (not in|<>|!=)','if caller_role is null or caller_role \1','g');
  if revised<>f.definition then execute revised; end if;
 end loop;
end
$migration$;
