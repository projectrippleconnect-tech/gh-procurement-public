-- Disposable PostgreSQL: validate contacts remain independent of route auto-send settings.
\ir company-stock-auto-rfq-isolated.sql
\ir ../../supabase/migrations/20261016042200_company_group_contact_pool.sql

DO $$
DECLARE co uuid:='00000000-0000-4000-8000-000000000101';
        root uuid:='00000000-0000-4000-8000-000000000201';
        child uuid:='00000000-0000-4000-8000-000000000202';
        one uuid:='00000000-0000-4000-8000-000000000011';
        two uuid:='00000000-0000-4000-8000-000000000012';
        admin uuid:='00000000-0000-4000-8000-000000000001';
        worker uuid:='00000000-0000-4000-8000-000000000002';
        before_route record; denied boolean:=false;
BEGIN
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 ASSERT EXISTS(SELECT 1 FROM public.proc_company_group_contacts WHERE section_id=child AND supplier_id=one),
  'Existing child routing contacts must backfill into the separate group contact directory';
 SELECT route_mode,auto_send INTO before_route FROM public.proc_company_section_routes WHERE company_id=co AND section_id=child;
 PERFORM public.proc_company_save_group_contacts(co,root,ARRAY[one,two,one]);
 ASSERT (SELECT count(*)=2 FROM public.proc_company_group_contacts WHERE section_id=root),
  'Root group stores multiple suppliers without duplicate links';
 ASSERT (SELECT count(*)=1 FROM public.proc_company_group_contacts WHERE section_id=root AND supplier_id=one AND sort_order=1),
  'Original Supplier 1 order should be preserved';
 PERFORM public.proc_company_save_group_contacts(co,child,ARRAY[two,one]);
 ASSERT (SELECT count(*)=2 FROM public.proc_company_group_contacts WHERE section_id=child),
  'Subgroup may maintain its own contact list';
 ASSERT (SELECT route_mode=before_route.route_mode AND auto_send=before_route.auto_send
  FROM public.proc_company_section_routes WHERE company_id=co AND section_id=child),
  'Saving group contacts must never change an existing PO/RFQ rule or auto-send';
 PERFORM set_config('request.jwt.claim.sub',worker::text,true);
 denied:=false;
 BEGIN
  PERFORM public.proc_company_save_group_contacts(co,root,ARRAY[one]);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Stock handler must not edit supplier contact lists';
 PERFORM set_config('request.jwt.claim.sub',admin::text,true);
 denied:=false;
 BEGIN
  PERFORM public.proc_company_save_group_contacts(gen_random_uuid(),root,ARRAY[one]);
 EXCEPTION WHEN OTHERS THEN denied:=true; END;
 ASSERT denied,'Company and group mismatch must be rejected';
 ASSERT NOT has_table_privilege('authenticated','public.proc_company_group_contacts','INSERT'),
  'No direct client-side insertion should be possible';
 ASSERT NOT has_table_privilege('anon','public.proc_company_group_contacts','SELECT'),
  'Anonymous access must remain denied';
END $$;
