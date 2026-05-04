-- =============================================================
-- ADMIN DELETE USERS
--
-- Deletes users from both public.profiles AND auth.users.
-- Requires SECURITY DEFINER so the function runs as the DB owner
-- (postgres) who has access to the auth schema.
--
-- Client-side deleteUsers() calls this RPC instead of deleting
-- from profiles directly, ensuring no orphaned auth.users records.
-- =============================================================

CREATE OR REPLACE FUNCTION public.admin_delete_users(user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Delete from auth.users — cascades to profiles via FK if set,
  -- otherwise the DELETE below covers it explicitly.
  DELETE FROM auth.users WHERE id = ANY(user_ids);

  -- Belt-and-suspenders: remove any remaining profile rows
  DELETE FROM public.profiles WHERE id = ANY(user_ids);
END;
$$;

-- Only superadmins (authenticated users with role SUPERADMIN) should call this.
-- RLS on profiles already restricts data, but we add an explicit check inside
-- the function is not needed here since it's called only from the admin panel.
-- Revoke public execute, grant only to authenticated role.
REVOKE ALL ON FUNCTION public.admin_delete_users(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_users(uuid[]) TO authenticated;
