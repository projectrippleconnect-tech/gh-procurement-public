-- GH Procurement | Reviewed company section hierarchy
-- Uses existing Item Master labels; NEVER inserts/rekeys items or rewrites stock quantities/history.
-- Admin permission is checked before both preview and apply.
CREATE OR REPLACE FUNCTION private.proc_reviewed_section_plan_v1()
RETURNS TABLE(company_id uuid,company_name text,list_id uuid,old_section_id uuid,item_order integer,section_path text[])
LANGUAGE sql STABLE SET search_path TO '' AS $plan$
SELECT c.id,c.name,l.id,l.section_id,l.sort_order,
 CASE
 WHEN c.name='BOARD ITEMS' THEN
   CASE
    WHEN l.sort_order BETWEEN 0 AND 6 THEN ARRAY['BOARD ITEMS','PLYWOOD BOARDS']
    WHEN l.sort_order BETWEEN 7 AND 13 THEN ARRAY['BOARD ITEMS','MDF BOARDS']
    WHEN l.sort_order BETWEEN 14 AND 41 THEN ARRAY['BOARD ITEMS','MELAMINE BOARDS',COALESCE(NULLIF(upper(i.colour),''),'FINISH TO REVIEW')]
    WHEN l.sort_order BETWEEN 42 AND 48 THEN ARRAY['BOARD ITEMS','FILM-FACED BOARDS']
    WHEN l.sort_order BETWEEN 49 AND 55 THEN ARRAY['BOARD ITEMS','SHUTTERING BOARDS']
    WHEN l.sort_order BETWEEN 56 AND 62 THEN ARRAY['BOARD ITEMS','CLADDING BOARDS']
    WHEN l.sort_order IN (63,66) THEN ARRAY['BOARD ITEMS','HARDBOARDS']
    WHEN l.sort_order IN (64,65) THEN ARRAY['BOARD ITEMS','PVC BOARDS']
    ELSE NULL::text[] END
 WHEN c.name='FEVICOL' THEN ARRAY['FEVICOL',coalesce(nullif(i.main_group,''),'PRODUCT TYPE TO REVIEW'),coalesce(nullif(i.subgroup,''),'SERIES TO REVIEW')]
 WHEN c.name='POLYCHROME' THEN
  CASE WHEN i.main_group IN ('ENCLOSURE BOXES','SUNK BOXES') THEN
    ARRAY['POLYCHROME',i.main_group,coalesce(nullif(i.subgroup,''),'TYPE TO REVIEW')]
   ELSE ARRAY['POLYCHROME',coalesce(nullif(i.main_group,''),'PRODUCT TYPE TO REVIEW')] END
 WHEN c.name='ROCKER' THEN ARRAY['ROCKER',coalesce(nullif(i.main_group,''),'PRODUCT TYPE TO REVIEW')]
 WHEN c.name='WURTH' THEN ARRAY['WURTH',CASE
    WHEN i.description ILIKE '%SILICONE%' THEN 'SEALANTS'
    WHEN i.description ILIKE '%ANCHORING%' THEN 'ANCHORING ADHESIVES'
    WHEN i.description ILIKE '%CUTTING WHEEL%' THEN 'CUTTING WHEELS'
    WHEN i.description ILIKE '%WEATHER SHIELD%' THEN 'WEATHERPROOFING'
    WHEN i.description ILIKE '%RUST OFF%' THEN 'RUST TREATMENT'
    ELSE 'OTHER PRODUCTS — REVIEW' END]
 WHEN c.name='KOBE' THEN ARRAY['KOBE',CASE
    WHEN i.description ILIKE '%LED FLOODLIGHT%' THEN 'LED FLOODLIGHTS'
    WHEN i.description ILIKE '%WHEELBARROW%' THEN 'WHEELBARROWS'
    WHEN i.description ILIKE '%CROWBAR%' THEN 'CROWBARS'
    WHEN i.description ILIKE '%SHOVEL%' THEN 'SHOVELS'
    WHEN i.description ILIKE '%PADLOCK%' THEN 'PADLOCKS'
    ELSE 'OTHER PRODUCTS — REVIEW' END]
 WHEN c.name='MULTI BOND' THEN ARRAY['MULTI BOND',
   CASE WHEN nullif(i.subgroup,'') IS NULL OR i.subgroup='MULTI BOND'
        THEN 'GENERAL — TYPE UNCONFIRMED' ELSE i.subgroup END]
 WHEN c.name='CASING' THEN ARRAY['CASING',CASE WHEN l.sort_order BETWEEN 0 AND 3 THEN 'STANDARD SIZES' ELSE 'RECTANGULAR SIZES' END]
 WHEN c.name='RUBBER HOSE' THEN ARRAY['RUBBER HOSE',
    CASE WHEN l.sort_order IN (0,1) THEN '1/2IN'
         WHEN l.sort_order IN (2,3) THEN '3/4IN'
         ELSE '1IN' END]
 WHEN c.name='BIXTON' THEN ARRAY['BIXTON',
   CASE WHEN l.sort_order BETWEEN 0 AND 7 THEN 'DAYLIGHT (DL)' ELSE 'WARM WHITE' END,
   CASE WHEN upper(i.variation)='SUNK' THEN 'SUNK' WHEN upper(i.variation)='SURFACE' THEN 'SURFACE'
        ELSE 'MOUNTING TO REVIEW' END]
 WHEN c.name='BOLT & NUTS' THEN
   CASE WHEN s.name='YP BOLT' AND i.size IS NOT NULL THEN ARRAY['BOLT & NUTS','YP BOLT',upper(i.size)]
        WHEN s.name='YP Washer' AND i.variation IS NOT NULL THEN ARRAY['BOLT & NUTS','YP Washer',upper(i.variation)]
        ELSE NULL::text[] END
 WHEN c.name='WIRE CABLES' THEN ARRAY['WIRE CABLES',s.name,
   CASE WHEN l.sort_order BETWEEN 0 AND 29 THEN '1044 WIRES'
    WHEN l.sort_order BETWEEN 30 AND 54 THEN '7053 WIRES'
    WHEN l.sort_order BETWEEN 55 AND 79 THEN '7067 WIRES'
    WHEN l.sort_order BETWEEN 80 AND 94 THEN '7044 MAIN'
    WHEN l.sort_order BETWEEN 95 AND 99 THEN '7085 WIRES'
    WHEN l.sort_order BETWEEN 100 AND 104 THEN 'SINGLE-CORE WIRES'
    WHEN l.sort_order BETWEEN 105 AND 109 THEN 'TT WIRES'
    WHEN l.sort_order BETWEEN 110 AND 114 THEN 'COAXIAL CABLES'
    WHEN l.sort_order BETWEEN 115 AND 149 THEN 'MULTICORE CABLES'
    ELSE 'TYPE TO REVIEW' END]
 WHEN c.name='KEVILTON' THEN ARRAY['KEVILTON',s.name,
   CASE WHEN nullif(i.main_group,'') IS NULL OR i.main_group='KEVILTON'
   THEN 'PRODUCT TYPE TO REVIEW' ELSE i.main_group END]
 WHEN c.name='ORANGE' THEN
   CASE WHEN l.sort_order BETWEEN 0 AND 54 THEN
     ARRAY['ORANGE',s.name,coalesce(nullif(i.main_group,''),'PRODUCT TYPE TO REVIEW')]
   WHEN l.sort_order BETWEEN 55 AND 58 THEN
     ARRAY['ORANGE','CORDS & INSULATION',CASE WHEN l.sort_order<=57 THEN 'EXTENSION CORDS' ELSE 'INSULATION TAPE' END]
   WHEN l.sort_order BETWEEN 59 AND 65 THEN ARRAY['ORANGE','ELECTRICAL PROTECTION','ALPHA']
   WHEN l.sort_order BETWEEN 66 AND 72 THEN ARRAY['ORANGE','ELECTRICAL PROTECTION','SIGMA']
   ELSE NULL::text[] END
 WHEN c.name='PANEL SHEETS' AND l.sort_order BETWEEN 12 AND 29 THEN ARRAY['PANEL SHEETS','I PANEL',
   CASE floor((l.sort_order-12)/2)
    WHEN 0 THEN 'TEAK'
    WHEN 1 THEN 'BURMA TEAK'
    WHEN 2 THEN 'PVST 007'
    WHEN 3 THEN 'PVST 04'
    WHEN 4 THEN 'PVST 12A'
    WHEN 5 THEN 'PVST 21A'
    WHEN 6 THEN 'PVST 16A'
    WHEN 7 THEN 'PVST 10A'
    ELSE 'APPLE WOOD' END]
 ELSE NULL::text[]
 END::text[] AS section_path
FROM public.proc_company_list_items l
JOIN public.proc_companies c ON c.id=l.company_id
JOIN public.proc_items i ON i.id=l.item_id
LEFT JOIN public.proc_company_sections s ON s.id=l.section_id
WHERE l.active AND c.name IN
('BOARD ITEMS','FEVICOL','POLYCHROME','ROCKER','WURTH','KOBE','MULTI BOND',
'CASING','RUBBER HOSE','BIXTON','BOLT & NUTS','WIRE CABLES','KEVILTON','ORANGE','PANEL SHEETS')
AND c.company_list_enabled IS DISTINCT FROM FALSE
$plan$;

CREATE OR REPLACE FUNCTION public.proc_apply_reviewed_company_hierarchy_v1(p_preview boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $apply$
DECLARE r record; v_name text; v_id uuid; v_parent uuid; v_count integer;
 v_new integer:=0;v_moved integer:=0;v_expected integer;v_checked integer;
 v_total integer;v_company_count integer;v_baseline_changed integer;
 v_color text;
BEGIN
 PERFORM private.proc_assert_access();
 IF auth.uid() IS NULL OR NOT EXISTS
   (SELECT 1 FROM public.proc_profiles p WHERE p.id=auth.uid() AND p.active AND p.role='admin')
 THEN RAISE EXCEPTION 'A signed-in Super Admin is required'; END IF;
 PERFORM private.proc_assert_permission('company_lists.manage');
 SELECT count(*),count(DISTINCT company_id) INTO v_total,v_company_count
 FROM private.proc_reviewed_section_plan_v1()
 WHERE section_path IS NOT NULL AND cardinality(section_path)>=2;
 IF p_preview THEN
  RETURN jsonb_build_object('ok',true,'preview',true,
   'planned_items',v_total,'company_lists',v_company_count,
   'company_examples',(SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb)
      FROM (SELECT company_name,count(*) as items,count(distinct section_path) as group_paths
       FROM private.proc_reviewed_section_plan_v1() WHERE section_path IS NOT NULL
       GROUP BY company_name ORDER BY company_name) x),
   'notice','Only existing active item section IDs will change. No stock values, source keys, identities or history are rewritten.');
 END IF;
 -- Protect against unexpected source data drift. The operation is atomic.
 IF v_total<450 OR v_company_count<12 THEN
  RAISE EXCEPTION 'Reviewed hierarchy preflight failed: % items / % companies',v_total,v_company_count;
 END IF;
 CREATE TEMP TABLE _reviewed_hierarchy_original ON COMMIT DROP AS
 SELECT l.id,(to_jsonb(l)-'section_id'-'updated_at') AS before_record
 FROM public.proc_company_list_items l
 JOIN private.proc_reviewed_section_plan_v1() p ON p.list_id=l.id
 WHERE p.section_path IS NOT NULL AND cardinality(p.section_path)>=2;
 SELECT count(*) INTO v_expected FROM pg_temp._reviewed_hierarchy_original;
 IF v_expected<>v_total THEN RAISE EXCEPTION 'Duplicate or missing target rows'; END IF;

 -- Preserve KOBE LED section ID while correcting its old abbreviated label.
 UPDATE public.proc_company_sections s SET name='LED FLOODLIGHTS',updated_at=now()
 WHERE s.company_id=(SELECT id FROM public.proc_companies WHERE name='KOBE')
  AND s.name='LED FLASH' AND s.active
  AND NOT EXISTS(SELECT 1 FROM public.proc_company_sections z
   WHERE z.company_id=s.company_id AND z.parent_id IS NOT DISTINCT FROM s.parent_id
   AND z.active AND z.name='LED FLOODLIGHTS');
 FOR r IN SELECT * FROM private.proc_reviewed_section_plan_v1()
  WHERE section_path IS NOT NULL AND cardinality(section_path)>=2
  ORDER BY company_name,item_order,list_id
 LOOP
  v_parent:=NULL;
  FOREACH v_name IN ARRAY r.section_path LOOP
   SELECT count(*),min(s.id) INTO v_count,v_id
   FROM public.proc_company_sections s
   WHERE s.company_id=r.company_id AND s.active
    AND s.parent_id IS NOT DISTINCT FROM v_parent
    AND upper(s.name)=upper(v_name);
   IF v_count>1 THEN RAISE EXCEPTION 'Duplicate company section: % / %',r.company_name,v_name; END IF;
   IF v_id IS NULL THEN
    IF v_parent IS NULL THEN RAISE EXCEPTION 'Company root section missing: %',r.company_name; END IF;
    v_color:=CASE WHEN cardinality(r.section_path)>=3 AND v_name=r.section_path[3]
      THEN '#0F766E' ELSE '#2563EB' END;
    INSERT INTO public.proc_company_sections(company_id,parent_id,name,sort_order,color,active)
    VALUES(r.company_id,v_parent,v_name,r.item_order,v_color,true)
    RETURNING id INTO v_id;
    v_new:=v_new+1;
   END IF;
   v_parent:=v_id;
  END LOOP;
  IF r.old_section_id IS DISTINCT FROM v_parent THEN
   UPDATE public.proc_company_list_items SET section_id=v_parent
   WHERE id=r.list_id AND company_id=r.company_id AND active
   AND section_id IS NOT DISTINCT FROM r.old_section_id;
   GET DIAGNOSTICS v_checked=ROW_COUNT;
   IF v_checked<>1 THEN RAISE EXCEPTION 'Item section changed concurrently: %',r.list_id; END IF;
   v_moved:=v_moved+1;
  END IF;
 END LOOP;
 SELECT count(*) INTO v_baseline_changed FROM pg_temp._reviewed_hierarchy_original b
 JOIN public.proc_company_list_items l ON l.id=b.id
 WHERE (to_jsonb(l)-'section_id'-'updated_at') IS DISTINCT FROM b.before_record;
 IF v_baseline_changed<>0 THEN
  RAISE EXCEPTION 'Protected stock or item identity changed in % rows; rolling back',v_baseline_changed;
 END IF;
 RETURN jsonb_build_object('ok',true,'preview',false,'items_examined',v_total,
  'company_lists',v_company_count,'items_moved',v_moved,'sections_created',v_new,
  'preserved_identity_and_stock',true);
END $apply$;

REVOKE ALL ON FUNCTION public.proc_apply_reviewed_company_hierarchy_v1(boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.proc_apply_reviewed_company_hierarchy_v1(boolean) TO authenticated;
