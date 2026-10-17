-- Reset operational records while preserving company catalogues and their price references.
-- Applying this definition does not reset any data.
create or replace function private.proc_data_reset_tables(p_scope text)
returns text[] language plpgsql immutable set search_path='' as $$
 begin return case p_scope
 when 'procurement' then array['proc_company_attachments','proc_company_dispatch_queue','proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements']
 when 'lists' then array['proc_company_attachments','proc_company_price_documents','proc_company_price_list_lines','proc_company_price_lists','proc_company_list_items']
 when 'stock' then array['proc_stock_count_drafts','proc_stock_balances']
 when 'full' then array['proc_company_attachments','proc_company_dispatch_queue','proc_automation_jobs','proc_whatsapp_po_dispatches','proc_whatsapp_rfq_dispatches','proc_po_balance_actions','proc_rejection_cases','proc_grn_lines','proc_grns','proc_invoice_lines','proc_supplier_invoices','proc_po_lines','proc_purchase_orders','proc_awards','proc_quote_lines','proc_quotes','proc_rfq_suppliers','proc_rfq_items','proc_rfqs','proc_item_requests','proc_requirements']||array['proc_stock_ledger','proc_stock_count_lines','proc_stock_counts','proc_stock_count_drafts','proc_stock_balances']
 else null end; end
$$;
