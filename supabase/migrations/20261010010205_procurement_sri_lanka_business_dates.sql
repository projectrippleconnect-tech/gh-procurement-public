-- Keep procurement business dates in Sri Lanka without changing shared database timezone.
alter function public.proc_finalize_award_plan_v1(uuid,jsonb) set timezone='Asia/Colombo';
alter function public.proc_straight_through_stock_count_v2(uuid) set timezone='Asia/Colombo';
alter function private.proc_automation_sweep_v1() set timezone='Asia/Colombo';
alter function private.proc_create_po_from_quote_impl(uuid) set timezone='Asia/Colombo';
alter function private.proc_create_best_price_pos_impl(uuid) set timezone='Asia/Colombo';
alter function public.proc_straight_through_stock_count_v1(uuid) set timezone='Asia/Colombo';
alter function public.proc_finalize_award_plan_v2(uuid,jsonb) set timezone='Asia/Colombo';
alter function public.proc_try_auto_award_v2(uuid) set timezone='Asia/Colombo';
alter table public.proc_purchase_orders alter column po_date set default ((now() at time zone 'Asia/Colombo')::date);
alter table public.proc_stock_counts alter column count_date set default ((now() at time zone 'Asia/Colombo')::date);
alter table public.proc_quotes alter column quote_date set default ((now() at time zone 'Asia/Colombo')::date);
alter table public.proc_supplier_invoices alter column invoice_date set default ((now() at time zone 'Asia/Colombo')::date);
alter table public.proc_grns alter column received_date set default ((now() at time zone 'Asia/Colombo')::date);

create or replace view public.proc_v_quote_comparison with (security_invoker=true) as
 WITH line_cost AS (
         SELECT qi.rfq_id,
            qi.id AS rfq_item_id,
            qi.requirement_id,
            qi.requested_qty,
            s.id AS supplier_id,
            s.supplier_code,
            s.name AS supplier_name,
            q.id AS quote_id,
            q.quote_ref,
            q.quote_date,
            q.valid_until,
            q.freight_total,
            q.minimum_order_value,
            ql.id AS quote_line_id,
            ql.unit_price,
            ql.available_qty,
            ql.lead_days,
            ql.discount_percent,
            ql.tax_percent,
            ql.moq,
            ql.order_multiple,
            round((ql.unit_price * ((1)::numeric - (ql.discount_percent / 100.0))), 4) AS net_unit_price,
            round(((ql.unit_price * ((1)::numeric - (ql.discount_percent / 100.0))) * ((1)::numeric + (ql.tax_percent / 100.0))), 4) AS effective_unit_price,
            sum(GREATEST(LEAST(COALESCE(ql.available_qty, qi.requested_qty), qi.requested_qty), (0)::numeric)) OVER (PARTITION BY q.id) AS quote_qty_basis
           FROM (((proc_rfq_items qi
             JOIN proc_quotes q ON ((q.rfq_id = qi.rfq_id)))
             JOIN proc_suppliers s ON (((s.id = q.supplier_id) AND (s.active = true))))
             JOIN proc_quote_lines ql ON (((ql.quote_id = q.id) AND (ql.rfq_item_id = qi.id))))
          WHERE ((q.status = ANY (ARRAY['received'::text, 'reviewed'::text, 'selected'::text])) AND (ql.unit_price >= (0)::numeric) AND ((q.valid_until IS NULL) OR (q.valid_until >= (now() at time zone 'Asia/Colombo')::date)))
        ), landed AS (
         SELECT lc.rfq_id,
            lc.rfq_item_id,
            lc.requirement_id,
            lc.requested_qty,
            lc.supplier_id,
            lc.supplier_code,
            lc.supplier_name,
            lc.quote_id,
            lc.quote_ref,
            lc.quote_date,
            lc.valid_until,
            lc.freight_total,
            lc.minimum_order_value,
            lc.quote_line_id,
            lc.unit_price,
            lc.available_qty,
            lc.lead_days,
            lc.discount_percent,
            lc.tax_percent,
            lc.moq,
            lc.order_multiple,
            lc.net_unit_price,
            lc.effective_unit_price,
            lc.quote_qty_basis,
            round(
                CASE
                    WHEN (COALESCE(lc.quote_qty_basis, (0)::numeric) > (0)::numeric) THEN (lc.freight_total / lc.quote_qty_basis)
                    ELSE (0)::numeric
                END, 4) AS freight_unit_cost,
            round((lc.effective_unit_price +
                CASE
                    WHEN (COALESCE(lc.quote_qty_basis, (0)::numeric) > (0)::numeric) THEN (lc.freight_total / lc.quote_qty_basis)
                    ELSE (0)::numeric
                END), 4) AS landed_unit_cost
           FROM line_cost lc
        )
 SELECT rfq_id,
    rfq_item_id,
    requirement_id,
    supplier_id,
    supplier_code,
    supplier_name,
    quote_id,
    quote_ref,
    quote_line_id,
    unit_price,
    available_qty,
    lead_days,
    discount_percent,
    tax_percent,
    dense_rank() OVER (PARTITION BY rfq_item_id ORDER BY effective_unit_price, supplier_code) AS price_rank,
    effective_unit_price,
    valid_until,
    net_unit_price,
    requested_qty,
    quote_date,
    freight_total,
    minimum_order_value,
    moq,
    order_multiple,
    quote_qty_basis,
    freight_unit_cost,
    landed_unit_cost,
    dense_rank() OVER (PARTITION BY rfq_item_id ORDER BY landed_unit_cost, supplier_code) AS landed_rank
   FROM landed;

create or replace view public.proc_v_stock_check_due with (security_invoker=true) as
 WITH feature_cfg AS (
         SELECT COALESCE(proc_feature_settings.config, '{}'::jsonb) AS cfg
           FROM proc_feature_settings
          WHERE (proc_feature_settings.feature_key = 'stock.cycle_counting'::text)
         LIMIT 1
        ), cfg AS (
         SELECT COALESCE((NULLIF((feature_cfg.cfg ->> 'fast_days'::text), ''::text))::integer, 7) AS fast_days,
            COALESCE((NULLIF((feature_cfg.cfg ->> 'normal_days'::text), ''::text))::integer, 14) AS normal_days,
            COALESCE((NULLIF((feature_cfg.cfg ->> 'slow_days'::text), ''::text))::integer, 28) AS slow_days
           FROM feature_cfg
        ), loc AS (
         SELECT proc_locations.id
           FROM proc_locations
          WHERE (proc_locations.active = true)
          ORDER BY proc_locations.created_at
         LIMIT 1
        )
 SELECT i.id AS item_id,
    i.item_code,
    i.category,
    i.description,
    i.main_group,
    i.subgroup,
    i.size,
    i.uom,
    i.movement,
    i.max_stock,
    i.reorder_level,
    b.qty AS book_stock,
    b.last_counted_at,
        CASE i.movement
            WHEN 'FAST'::text THEN cfg.fast_days
            WHEN 'SLOW'::text THEN cfg.slow_days
            ELSE cfg.normal_days
        END AS check_every_days,
        CASE
            WHEN (b.last_counted_at IS NULL) THEN (now() at time zone 'Asia/Colombo')::date
            ELSE ((b.last_counted_at at time zone 'Asia/Colombo')::date +
            CASE i.movement
                WHEN 'FAST'::text THEN cfg.fast_days
                WHEN 'SLOW'::text THEN cfg.slow_days
                ELSE cfg.normal_days
            END)
        END AS next_check_date,
    ((b.last_counted_at IS NULL) OR (((b.last_counted_at at time zone 'Asia/Colombo')::date +
        CASE i.movement
            WHEN 'FAST'::text THEN cfg.fast_days
            WHEN 'SLOW'::text THEN cfg.slow_days
            ELSE cfg.normal_days
        END) <= (now() at time zone 'Asia/Colombo')::date)) AS is_due,
        CASE
            WHEN (b.last_counted_at IS NULL) THEN NULL::integer
            ELSE GREATEST(((now() at time zone 'Asia/Colombo')::date - ((b.last_counted_at at time zone 'Asia/Colombo')::date +
            CASE i.movement
                WHEN 'FAST'::text THEN cfg.fast_days
                WHEN 'SLOW'::text THEN cfg.slow_days
                ELSE cfg.normal_days
            END)), 0)
        END AS days_overdue,
    i.brand
   FROM (((proc_items i
     CROSS JOIN cfg)
     CROSS JOIN loc)
     LEFT JOIN proc_stock_balances b ON (((b.item_id = i.id) AND (b.location_id = loc.id))))
  WHERE (i.active = true);
