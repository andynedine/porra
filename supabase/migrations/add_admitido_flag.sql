-- =============================================================
-- Migration: add_admitido_flag
-- Adds an "admitido" boolean flag to profiles.
-- Users can register & verify email, but cannot submit any
-- prediction until a SUPERADMIN sets admitido = TRUE.
-- =============================================================

-- 1. Column
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admitido BOOLEAN NOT NULL DEFAULT FALSE;

-- SUPERADMIN accounts are auto-admitted
UPDATE public.profiles SET admitido = TRUE WHERE role = 'SUPERADMIN';

-- 2. Helper function: is the current user admitted?
CREATE OR REPLACE FUNCTION public.is_admitted()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT admitido FROM public.profiles WHERE id = auth.uid()),
    FALSE
  );
$$;

-- =============================================================
-- 3. Tighten RLS on PREDICTIONS to require admitido = TRUE
-- =============================================================

-- Match predictions
DROP POLICY IF EXISTS "predictions_insert" ON public.predictions;
CREATE POLICY "predictions_insert" ON public.predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_admitted()
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id
        AND NOT public.deadline_passed(m.round)
    )
  );

DROP POLICY IF EXISTS "predictions_update" ON public.predictions;
CREATE POLICY "predictions_update" ON public.predictions
  FOR UPDATE USING (
    (
      auth.uid() = user_id
      AND public.is_admitted()
      AND EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = predictions.match_id
          AND NOT public.deadline_passed(m.round)
      )
    )
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS "predictions_delete" ON public.predictions;
CREATE POLICY "predictions_delete" ON public.predictions
  FOR DELETE USING (
    (
      auth.uid() = user_id
      AND public.is_admitted()
      AND EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = predictions.match_id
          AND NOT public.deadline_passed(m.round)
      )
    )
    OR public.is_superadmin()
  );

-- =============================================================
-- 4. Tighten RLS on GROUP POSITION PREDICTIONS
-- =============================================================
DROP POLICY IF EXISTS "gpp_insert" ON public.group_position_predictions;
CREATE POLICY "gpp_insert" ON public.group_position_predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_admitted()
    AND NOT public.deadline_passed('group')
  );

DROP POLICY IF EXISTS "gpp_update" ON public.group_position_predictions;
CREATE POLICY "gpp_update" ON public.group_position_predictions
  FOR UPDATE USING (
    (auth.uid() = user_id AND public.is_admitted() AND NOT public.deadline_passed('group'))
    OR public.is_superadmin()
  );

DROP POLICY IF EXISTS "gpp_delete" ON public.group_position_predictions;
CREATE POLICY "gpp_delete" ON public.group_position_predictions
  FOR DELETE USING (
    (auth.uid() = user_id AND public.is_admitted() AND NOT public.deadline_passed('group'))
    OR public.is_superadmin()
  );

-- =============================================================
-- 5. Tighten RLS on TOURNAMENT PREDICTIONS
-- =============================================================
DROP POLICY IF EXISTS "tp_insert" ON public.tournament_predictions;
CREATE POLICY "tp_insert" ON public.tournament_predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND public.is_admitted()
    AND NOT public.deadline_passed('tournament')
  );

DROP POLICY IF EXISTS "tp_update" ON public.tournament_predictions;
CREATE POLICY "tp_update" ON public.tournament_predictions
  FOR UPDATE USING (
    (auth.uid() = user_id AND public.is_admitted() AND NOT public.deadline_passed('tournament'))
    OR public.is_superadmin()
  );
