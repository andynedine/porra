-- =============================================================
-- Migration: add_group_position_results
-- Creates the official group standings table (entered by SUPERADMIN)
-- to score user group_position_predictions.
-- Run in Supabase SQL Editor.
-- =============================================================

-- ---- Table --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_position_results (
  id               SERIAL      PRIMARY KEY,
  group_id         INTEGER     NOT NULL UNIQUE REFERENCES public.groups(id) ON DELETE CASCADE,
  pos_1_team_id    INTEGER     REFERENCES public.teams(id),
  pos_2_team_id    INTEGER     REFERENCES public.teams(id),
  pos_3_team_id    INTEGER     REFERENCES public.teams(id),
  pos_4_team_id    INTEGER     REFERENCES public.teams(id),
  entered_by       UUID        REFERENCES public.profiles(id),
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE public.group_position_results
  IS 'Official final standings per group, entered by SUPERADMIN. Used to score group_position_predictions.';

-- ---- RLS ----------------------------------------------------
ALTER TABLE public.group_position_results ENABLE ROW LEVEL SECURITY;

-- Everyone can read the official results
CREATE POLICY "group_pos_results_read"
  ON public.group_position_results
  FOR SELECT
  USING (true);

-- Only SUPERADMIN can insert / update / delete
CREATE POLICY "group_pos_results_write"
  ON public.group_position_results
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'SUPERADMIN'
    )
  );
