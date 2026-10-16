-- Revoke table-control privileges that Supabase defaults added to a later table.
-- Keep the existing row-level application grants and policies unchanged.
DO $$DECLARE t record;BEGIN
 FOR t IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND left(c.relname,5)='proc_'
 LOOP EXECUTE format('REVOKE TRUNCATE,REFERENCES,TRIGGER ON TABLE %I.%I FROM anon,authenticated',t.nspname,t.relname);END LOOP;
END $$;

-- Legacy clients still call v2. Execute internal routing as its owner while
-- validating the real caller, as v3 already does; never expose private helpers.
CREATE OR REPLACE FUNCTION private.proc_submit_company_list_check_impl(p_company_id uuid, p_lines jsonb, p_notes text DEFAULT NULL::text, p_count_started_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare caller uuid:=auth.uid();c public.proc_companies;loc uuid;count_id_v uuid;count_no_v text;x jsonb;cli public.proc_company_list_items;it public.proc_items;current_v numeric;trigger_v numeric;suggested numeric;enough boolean;req_count integer;ids uuid[];orders jsonb:='[]';errors_v jsonb:='[]';
begin
 perform private.proc_assert_access();
 if not private.proc_has_permission('stock.count.enter') or not private.proc_has_permission('company_lists.view') then raise exception 'Stock entry permission required';end if;
 if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>1000 then raise exception 'Choose 1–1000 counted items';end if;
 if p_count_started_at>clock_timestamp()+interval '2 minutes' then raise exception 'Counting start time is in the future. Check device time and start a fresh count';end if;
 select * into c from public.proc_companies where id=p_company_id and active and company_list_enabled for update;
 if c.id is null then raise exception 'Company list not found';end if;
 if (select count(distinct value->>'company_list_item_id') from jsonb_array_elements(p_lines))<>jsonb_array_length(p_lines) then raise exception 'Duplicate company stock item';end if;
 loc:=private.proc_default_location_id();count_no_v:='COMPANY-'||gen_random_uuid();
 insert into public.proc_stock_counts(count_no,location_id,category,status,counted_by,notes,count_started_at)
 values(count_no_v,loc,'COMPANY: '||c.name,'draft',caller,p_notes,coalesce(p_count_started_at,now())) returning id,count_no into count_id_v,count_no_v;
 for x in select value from jsonb_array_elements(p_lines) loop
  select * into cli from public.proc_company_list_items where id=(x->>'company_list_item_id')::uuid and company_id=c.id and active;
  if cli.id is null then raise exception 'Invalid company-list item';end if;
  select * into it from public.proc_items where id=cli.item_id and active;
  if it.id is null then raise exception 'Inactive company item';end if;
  enough:=coalesce((x->>'sufficient_stock')::boolean,false);
  if cli.max_stock_review and not enough then raise exception 'Admin must enter maximum stock before ordering this item';end if;
  current_v:=case when enough then null else (x->>'current_stock')::numeric end;
  if not enough and (current_v is null or current_v<0 or current_v::text in ('NaN','Infinity','-Infinity')) then raise exception 'Invalid current stock';end if;
  trigger_v:=coalesce(cli.reorder_level,cli.target_stock*.5);
  suggested:=case when enough then 0 when current_v<=trigger_v then greatest(cli.target_stock-current_v,0) else 0 end;
  insert into public.proc_stock_count_lines(count_id,item_id,current_stock,max_stock_snapshot,reorder_level_snapshot,movement_snapshot,suggested_qty,required_qty,sufficient_stock,note)
  values(count_id_v,it.id,current_v,cli.target_stock,trigger_v,it.movement,suggested,suggested,enough,nullif(x->>'note',''));
 end loop;
 req_count:=private.proc_submit_stock_count_impl(count_id_v);
 ids:=private.proc_company_link_count(c.id,count_id_v);
 if coalesce(cardinality(ids),0)>0 and (c.auto_approve or c.group_auto_approve or exists (
   select 1 from public.proc_requirements req
   cross join lateral private.proc_company_effective_route(c.id,req.item_id) rt(route)
   where req.id=any(ids) and req.company_id=c.id
   and rt.route->>'mode'='direct' and coalesce((rt.route->>'explicit')::boolean,false)
   and coalesce((rt.route->>'auto_send')::boolean,false)
  )) then
  begin
   orders:=private.proc_company_auto_from_count(c.id,count_id_v,ids);
  exception when others then
   -- Document/approval failures must not discard a valid physical stock count.
   errors_v:=jsonb_build_array(jsonb_build_object('stage','direct_po','error',SQLERRM));
  end;
 end if;
 return jsonb_build_object('count_id',count_id_v,'count_no',count_no_v,'requirements_created',req_count,'purchase_orders',orders,'company_id',c.id,'automation_errors',errors_v);
end $function$;


REVOKE ALL ON FUNCTION private.proc_submit_company_list_check_impl(uuid,jsonb,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.proc_submit_company_list_check_impl(uuid,jsonb,text,timestamptz) TO authenticated;
CREATE OR REPLACE FUNCTION public.proc_submit_company_list_check_v2(p_company_id uuid,p_lines jsonb,p_notes text DEFAULT NULL,p_count_started_at timestamptz DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
 SELECT private.proc_submit_company_list_check_impl(p_company_id,p_lines,p_notes,p_count_started_at)
$$;
REVOKE ALL ON FUNCTION public.proc_submit_company_list_check_v2(uuid,jsonb,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_submit_company_list_check_v2(uuid,jsonb,text,timestamptz) TO authenticated;
