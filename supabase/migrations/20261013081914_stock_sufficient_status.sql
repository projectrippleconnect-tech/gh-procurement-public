-- Visual shelf checks carry no exact quantity. Preserve existing access guards.
begin;
alter table public.proc_stock_count_lines add column sufficient_stock boolean not null default false;
alter table public.proc_stock_count_lines alter column current_stock drop not null;
alter table public.proc_stock_count_lines add constraint proc_stock_visual_check_valid check (
 (sufficient_stock and current_stock is null and suggested_qty=0 and required_qty=0)
 or (not sufficient_stock and current_stock is not null)
);

do $migration$
declare definition text; original text;
begin
 -- Retain the installed API's authorization, access restrictions and validation.
 original:=pg_get_functiondef('public.proc_submit_stock_check_v4(text,jsonb,text,text,timestamptz)'::regprocedure);
 definition:=replace(original,
 'current_qty:=(line_json->>''current_stock'')::numeric;',
 'if line_json ? ''sufficient_stock'' and jsonb_typeof(line_json->''sufficient_stock'')<>''boolean'' then raise exception ''Sufficient stock must be a boolean''; end if;
    if coalesce((line_json->>''sufficient_stock'')::boolean,false) then
      if line_json->>''current_stock'' is not null then raise exception ''Sufficient stock cannot include an exact quantity''; end if;
      insert into public.proc_stock_count_lines(count_id,item_id,current_stock,max_stock_snapshot,reorder_level_snapshot,movement_snapshot,suggested_qty,required_qty,note,sufficient_stock)
      values(count_id,it.id,null,it.max_stock,it.reorder_level,it.movement,0,0,''Visually checked: sufficient stock above reorder level'',true);
      continue;
    end if;
    current_qty:=(line_json->>''current_stock'')::numeric;');
 if definition=original then raise exception 'Stock submission definition changed; review migration before applying'; end if;
 execute definition;

 original:=pg_get_functiondef('private.proc_submit_stock_count_impl(uuid)'::regprocedure);
 definition:=replace(original,'    select qty into prev_qty','    if not l.sufficient_stock then
    select qty into prev_qty');
 definition:=replace(definition,'    existing_req:=null;','    end if; -- Visual checks do not write quantities, balances or ledger transactions.
    existing_req:=null;');
 if definition=original or position('if not l.sufficient_stock then' in definition)=0 then raise exception 'Stock count implementation changed; review migration before applying'; end if;
 execute definition;

 original:=pg_get_functiondef('public.proc_stock_submission_history_v1(integer)'::regprocedure);
 definition:=replace(original,'coalesce(cl.current_stock,0)=0','cl.current_stock=0');
 if definition=original then raise exception 'Stock history definition changed; review migration before applying'; end if;
 execute definition;
end
$migration$;
commit;
