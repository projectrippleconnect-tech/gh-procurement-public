-- Read-only per-item stock-count audit. General and Company counts stay separate.
-- Reuse the same visibility rules as proc_stock_submission_detail_v1; stock-only
-- users may read their own counts without receiving purchasing calculations.
CREATE INDEX IF NOT EXISTS proc_stock_count_lines_item_count_history_idx
 ON public.proc_stock_count_lines(item_id,count_id);

CREATE OR REPLACE FUNCTION public.proc_stock_latest_item_submissions_v1(
  p_item_ids uuid[], p_company_id uuid DEFAULT NULL
)
RETURNS TABLE(item_id uuid,count_id uuid,count_no text,submitted_at timestamptz,
              current_stock numeric,sufficient_stock boolean,category text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE company_name text;
BEGIN
  PERFORM private.proc_assert_access();
  IF coalesce(array_length(p_item_ids,1),0)>300 THEN
    RAISE EXCEPTION 'Maximum 300 items per history request';
  END IF;
  IF p_company_id IS NOT NULL THEN
    SELECT name INTO company_name FROM public.proc_companies WHERE id=p_company_id;
    IF company_name IS NULL THEN RAISE EXCEPTION 'Company not found'; END IF;
  END IF;
  RETURN QUERY
  SELECT DISTINCT ON (l.item_id)
    l.item_id,c.id,c.count_no,c.submitted_at,l.current_stock,l.sufficient_stock,c.category
  FROM public.proc_stock_count_lines l
  JOIN public.proc_stock_counts c ON c.id=l.count_id
  WHERE l.item_id=ANY(p_item_ids)
    AND c.status='submitted'
    AND (CASE WHEN p_company_id IS NULL
         THEN c.category NOT LIKE 'COMPANY: %'
         ELSE c.category='COMPANY: '||company_name END)
    AND (c.counted_by=auth.uid()
         OR private.proc_has_permission('procurement.requirements.view')
         OR private.proc_has_permission('items.edit'))
  ORDER BY l.item_id,c.submitted_at DESC NULLS LAST,c.id DESC,l.id DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.proc_stock_item_submissions_v1(
  p_item_id uuid,p_company_id uuid DEFAULT NULL,p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(line_id uuid,count_id uuid,count_no text,submitted_at timestamptz,
              counted_by_name text,category text,current_stock numeric,
              sufficient_stock boolean,uom text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE company_name text;
BEGIN
  PERFORM private.proc_assert_access();
  IF p_item_id IS NULL THEN RAISE EXCEPTION 'Item is required'; END IF;
  IF p_company_id IS NOT NULL THEN
    SELECT name INTO company_name FROM public.proc_companies WHERE id=p_company_id;
    IF company_name IS NULL THEN RAISE EXCEPTION 'Company not found'; END IF;
  END IF;
  RETURN QUERY
  SELECT l.id,c.id,c.count_no,c.submitted_at,
         coalesce(nullif(trim(p.display_name),''),'Staff'),c.category,
         l.current_stock,l.sufficient_stock,i.uom
  FROM public.proc_stock_count_lines l
  JOIN public.proc_stock_counts c ON c.id=l.count_id
  JOIN public.proc_items i ON i.id=l.item_id
  LEFT JOIN public.proc_profiles p ON p.id=c.counted_by
  WHERE l.item_id=p_item_id AND c.status='submitted'
    AND (CASE WHEN p_company_id IS NULL
         THEN c.category NOT LIKE 'COMPANY: %'
         ELSE c.category='COMPANY: '||company_name END)
    AND (c.counted_by=auth.uid()
         OR private.proc_has_permission('procurement.requirements.view')
         OR private.proc_has_permission('items.edit'))
  ORDER BY c.submitted_at DESC NULLS LAST,c.id DESC,l.id DESC
  LIMIT least(greatest(coalesce(p_limit,50),1),100)
  OFFSET least(greatest(coalesce(p_offset,0),0),100000);
END;
$$;

REVOKE ALL ON FUNCTION public.proc_stock_latest_item_submissions_v1(uuid[],uuid)
 FROM public,anon;
REVOKE ALL ON FUNCTION public.proc_stock_item_submissions_v1(uuid,uuid,integer,integer)
 FROM public,anon;
GRANT EXECUTE ON FUNCTION public.proc_stock_latest_item_submissions_v1(uuid[],uuid)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.proc_stock_item_submissions_v1(uuid,uuid,integer,integer)
 TO authenticated;
