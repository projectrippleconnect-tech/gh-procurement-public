-- Applied to production on 2026-10-11. Fix effective permissions for restricted
-- staff without relaxing the RLS policies that protect roles and grants.
--
-- public.proc_my_permissions_v1() already filters pr.id = auth.uid(), requires
-- active profiles and enabled roles, and returns only explicitly allowed grants.
-- It needs definer execution because proc_roles and proc_role_permissions
-- deliberately restrict their SELECT policies to administrators.
--
-- The function's PostgreSQL owner is postgres. The schema search path is empty
-- so objects in the function body must remain schema-qualified.
ALTER FUNCTION public.proc_my_permissions_v1() SECURITY DEFINER;
ALTER FUNCTION public.proc_my_permissions_v1() SET search_path TO '';

-- Prevent anonymous clients from requesting authenticated staff grants.
REVOKE ALL ON FUNCTION public.proc_my_permissions_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.proc_my_permissions_v1() TO authenticated;
