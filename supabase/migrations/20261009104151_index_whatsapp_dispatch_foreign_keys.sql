create index if not exists proc_whatsapp_dispatch_supplier_idx on public.proc_whatsapp_rfq_dispatches(supplier_id);
create index if not exists proc_whatsapp_dispatch_sender_idx on public.proc_whatsapp_rfq_dispatches(sent_by);
