-- OPERATOR RELEASE STEP ONLY. Requires the reviewed portal migrations and pg_cron.
-- Creates one INACTIVE job. Does not enable purchasing or dispatch.
-- Run as the database owner after backup and hosted release checks.
begin;
do $$
declare job_id bigint;
begin
 if not exists(select 1 from pg_extension where extname='pg_cron') then
  raise exception 'pg_cron must already be installed';
 end if;
 if exists(select 1 from cron.job where jobname='gh-procurement-portal-rounds-v1') then
  raise exception 'Scheduler already exists; inspect it instead of replacing its owner or activation state';
 end if;
 job_id:=cron.schedule('gh-procurement-portal-rounds-v1','* * * * *','select private.proc_portal_run_due_rounds_v1();');
 perform cron.alter_job(job_id,active:=false);
end $$;
commit;

-- Separate activation, ONLY after release gates pass:
-- begin;
-- update private.proc_portal_scheduler_control set enabled=true where singleton;
-- select cron.alter_job((select jobid from cron.job where jobname='gh-procurement-portal-rounds-v1'),active:=true);
-- commit;
-- Immediate stop: disable the control row and cron job together in a transaction.
-- Web deployments should set GH_PORTAL_SCHEDULER_MODE=database. Dispatch remains
-- separately gated and is NOT run by this SQL job.
