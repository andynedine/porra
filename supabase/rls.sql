-- =============================================================
-- PORRA MUNDIAL 2026 — Row Level Security Policies
-- Run AFTER schema.sql
-- =============================================================

-- Enable RLS on every table
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_results             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deadlines                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_position_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_predictions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_results        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standings                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_logs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievements              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements         ENABLE ROW LEVEL SECURITY;

-- Helper: is current user a SUPERADMIN?
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'SUPERADMIN'
  );
$$;

-- Helper: has deadline passed for a given round?
CREATE OR REPLACE FUNCTION public.deadline_passed(p_round TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT deadline_at < NOW() FROM public.deadlines WHERE round = p_round),
    FALSE  -- if no deadline set, treat as not passed (allow predictions)
  );
$$;

-- =============================================================
-- PROFILES
-- =============================================================
-- Anyone authenticated can read profiles (for ranking display)
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT USING (auth.role() = 'authenticated');

-- Users can insert only their own profile (auto-created by trigger)
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Users can update their own profile; SUPERADMIN can update any
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE USING (
    auth.uid() = id OR public.is_superadmin()
  );

-- Only SUPERADMIN can delete profiles
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE USING (public.is_superadmin());

-- =============================================================
-- TEAMS (read-only for users; SUPERADMIN can modify)
-- =============================================================
CREATE POLICY "teams_select" ON public.teams
  FOR SELECT USING (true);

CREATE POLICY "teams_manage" ON public.teams
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- GROUPS (read-only)
-- =============================================================
CREATE POLICY "groups_select" ON public.groups
  FOR SELECT USING (true);

CREATE POLICY "groups_manage" ON public.groups
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- GROUP_TEAMS (read-only)
-- =============================================================
CREATE POLICY "group_teams_select" ON public.group_teams
  FOR SELECT USING (true);

CREATE POLICY "group_teams_manage" ON public.group_teams
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- MATCHES (read-only for users)
-- =============================================================
CREATE POLICY "matches_select" ON public.matches
  FOR SELECT USING (true);

CREATE POLICY "matches_manage" ON public.matches
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- MATCH RESULTS (everyone can read; only SUPERADMIN can write)
-- =============================================================
CREATE POLICY "match_results_select" ON public.match_results
  FOR SELECT USING (true);

CREATE POLICY "match_results_insert" ON public.match_results
  FOR INSERT WITH CHECK (public.is_superadmin());

CREATE POLICY "match_results_update" ON public.match_results
  FOR UPDATE USING (public.is_superadmin());

CREATE POLICY "match_results_delete" ON public.match_results
  FOR DELETE USING (public.is_superadmin());

-- =============================================================
-- DEADLINES (everyone can read; only SUPERADMIN can write)
-- =============================================================
CREATE POLICY "deadlines_select" ON public.deadlines
  FOR SELECT USING (true);

CREATE POLICY "deadlines_manage" ON public.deadlines
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- PREDICTIONS
-- SELECT: own predictions ALWAYS; other users' predictions only after deadline has passed
-- INSERT/UPDATE: own predictions ONLY; only before deadline
-- DELETE: own predictions before deadline; SUPERADMIN anytime
-- =============================================================
CREATE POLICY "predictions_select" ON public.predictions
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_superadmin()
    OR EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = predictions.match_id
        AND public.deadline_passed(m.round)
    )
  );

CREATE POLICY "predictions_insert" ON public.predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.matches m
      WHERE m.id = match_id
        AND NOT public.deadline_passed(m.round)
    )
  );

CREATE POLICY "predictions_update" ON public.predictions
  FOR UPDATE USING (
    (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = predictions.match_id
          AND NOT public.deadline_passed(m.round)
      )
    )
    OR public.is_superadmin()
  );

CREATE POLICY "predictions_delete" ON public.predictions
  FOR DELETE USING (
    (
      auth.uid() = user_id
      AND EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = predictions.match_id
          AND NOT public.deadline_passed(m.round)
      )
    )
    OR public.is_superadmin()
  );

-- =============================================================
-- GROUP POSITION PREDICTIONS (same pattern as predictions)
-- =============================================================
CREATE POLICY "gpp_select" ON public.group_position_predictions
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_superadmin()
    OR public.deadline_passed('group')
  );

CREATE POLICY "gpp_insert" ON public.group_position_predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT public.deadline_passed('group')
  );

CREATE POLICY "gpp_update" ON public.group_position_predictions
  FOR UPDATE USING (
    (auth.uid() = user_id AND NOT public.deadline_passed('group'))
    OR public.is_superadmin()
  );

CREATE POLICY "gpp_delete" ON public.group_position_predictions
  FOR DELETE USING (
    (auth.uid() = user_id AND NOT public.deadline_passed('group'))
    OR public.is_superadmin()
  );

-- =============================================================
-- TOURNAMENT PREDICTIONS
-- =============================================================
CREATE POLICY "tp_select" ON public.tournament_predictions
  FOR SELECT USING (
    auth.uid() = user_id
    OR public.is_superadmin()
    OR public.deadline_passed('tournament')
  );

CREATE POLICY "tp_insert" ON public.tournament_predictions
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND NOT public.deadline_passed('tournament')
  );

CREATE POLICY "tp_update" ON public.tournament_predictions
  FOR UPDATE USING (
    (auth.uid() = user_id AND NOT public.deadline_passed('tournament'))
    OR public.is_superadmin()
  );

-- =============================================================
-- TOURNAMENT RESULTS
-- =============================================================
CREATE POLICY "tr_select" ON public.tournament_results
  FOR SELECT USING (true);

CREATE POLICY "tr_manage" ON public.tournament_results
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- SCORES (everyone can read for ranking; only system can write)
-- =============================================================
CREATE POLICY "scores_select" ON public.scores
  FOR SELECT USING (true);

-- Scores are written by SECURITY DEFINER trigger functions only
CREATE POLICY "scores_manage" ON public.scores
  FOR ALL USING (public.is_superadmin());

-- =============================================================
-- STANDINGS
-- =============================================================
CREATE POLICY "standings_select" ON public.standings
  FOR SELECT USING (true);

CREATE POLICY "standings_manage" ON public.standings
  FOR ALL USING (public.is_superadmin());

-- =============================================================
-- CHANGE LOGS (only SUPERADMIN can read)
-- =============================================================
CREATE POLICY "change_logs_select" ON public.change_logs
  FOR SELECT USING (public.is_superadmin());

-- Inserted by SECURITY DEFINER functions
CREATE POLICY "change_logs_insert" ON public.change_logs
  FOR INSERT WITH CHECK (public.is_superadmin());

-- =============================================================
-- ACHIEVEMENTS (public read)
-- =============================================================
CREATE POLICY "achievements_select" ON public.achievements
  FOR SELECT USING (true);

CREATE POLICY "achievements_manage" ON public.achievements
  FOR ALL USING (public.is_superadmin())
  WITH CHECK (public.is_superadmin());

-- =============================================================
-- USER ACHIEVEMENTS
-- =============================================================
CREATE POLICY "user_achievements_select" ON public.user_achievements
  FOR SELECT USING (true);

-- Inserted only by SECURITY DEFINER trigger
CREATE POLICY "user_achievements_insert" ON public.user_achievements
  FOR INSERT WITH CHECK (public.is_superadmin());
