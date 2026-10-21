begin;
\ir ../fixtures/supplier-portal-native.sql
do $$
declare fixture jsonb;
begin
 fixture:=private.qa_portal_fixture();
 assert (fixture->>'round')::uuid is not null;
 assert (select count(*) from public.proc_quote_lines ql join public.proc_quotes q on q.id=ql.quote_id where q.rfq_id=(fixture->>'rfq')::uuid)=1,'Native fixture did not confirm an official quote';
end $$;
rollback;
