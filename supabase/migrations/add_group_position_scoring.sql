-- =============================================================
-- Migration: add_group_position_scoring
-- Wires the official group_position_results table to the
-- group_position_predictions scoring system.
--
-- Scoring rules:
--   +0.5 pts per correctly predicted position (pos 1–4)
--   +2.0 pts extra bonus if ALL 4 positions are correct (pleno)
--   Max per group = 4.0 pts
--
-- Run in Supabase SQL Editor AFTER add_group_position_results.sql
-- =============================================================

-- =============================================================
-- A) Fix calculate_group_position_points
--    Uses group_position_results (admin-entered) instead of
--    the auto-calculated standings table.
-- =============================================================
CREATE OR REPLACE FUNCTION public.calculate_group_position_points(
  p_user_id  UUID,
  p_group_id INTEGER
)
RETURNS DECIMAL(5,2) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pred   RECORD;
  v_result RECORD;
  v_correct INTEGER    := 0;
  v_points  DECIMAL(5,2) := 0;
BEGIN
  -- Get user's prediction for this group
  SELECT * INTO v_pred
  FROM public.group_position_predictions
  WHERE user_id = p_user_id AND group_id = p_group_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Get the admin-entered official result
  SELECT * INTO v_result
  FROM public.group_position_results
  WHERE group_id = p_group_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Count matching positions (ignore NULLs on either side)
  IF v_pred.pos_1_team_id IS NOT NULL AND v_result.pos_1_team_id IS NOT NULL
     AND v_pred.pos_1_team_id = v_result.pos_1_team_id THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_2_team_id IS NOT NULL AND v_result.pos_2_team_id IS NOT NULL
     AND v_pred.pos_2_team_id = v_result.pos_2_team_id THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_3_team_id IS NOT NULL AND v_result.pos_3_team_id IS NOT NULL
     AND v_pred.pos_3_team_id = v_result.pos_3_team_id THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_4_team_id IS NOT NULL AND v_result.pos_4_team_id IS NOT NULL
     AND v_pred.pos_4_team_id = v_result.pos_4_team_id THEN v_correct := v_correct + 1; END IF;

  -- 0.5 pts per correct position; +2 bonus for perfect (all 4 correct)
  v_points := v_correct * 0.5;
  IF v_correct = 4 THEN v_points := v_points + 2.0; END IF;

  -- Persist updated points
  UPDATE public.group_position_predictions
  SET points = v_points, calculated_at = NOW()
  WHERE user_id = p_user_id AND group_id = p_group_id;

  RETURN v_points;
END;
$$;

-- =============================================================
-- B) New helper: recalculate all users for a specific group
--    Called from the trigger below and from admin recalculate.
-- =============================================================
CREATE OR REPLACE FUNCTION public.recalculate_group_position_points_for_group(p_group_id INTEGER)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  -- Recalculate per-user points for this group
  FOR v_user_id IN
    SELECT DISTINCT user_id
    FROM public.group_position_predictions
    WHERE group_id = p_group_id
  LOOP
    PERFORM public.calculate_group_position_points(v_user_id, p_group_id);
  END LOOP;

  -- Refresh scores.group_position_points and total_points for affected users
  UPDATE public.scores s
  SET
    group_position_points = COALESCE((
      SELECT SUM(g.points)
      FROM public.group_position_predictions g
      WHERE g.user_id = s.user_id
        AND g.calculated_at IS NOT NULL
    ), 0),
    total_points = s.match_points
      + COALESCE((
          SELECT SUM(g.points)
          FROM public.group_position_predictions g
          WHERE g.user_id = s.user_id
            AND g.calculated_at IS NOT NULL
        ), 0)
      + s.tournament_points,
    updated_at = NOW()
  WHERE s.user_id IN (
    SELECT DISTINCT user_id
    FROM public.group_position_predictions
    WHERE group_id = p_group_id
  );

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'recalculate_group_position_points_for_group error (group_id=%): %', p_group_id, SQLERRM;
END;
$$;

-- =============================================================
-- C) Trigger: fire recalculation whenever admin saves a group result
-- =============================================================
CREATE OR REPLACE FUNCTION public.on_group_position_result_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM public.recalculate_group_position_points_for_group(NEW.group_id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_group_position_result_change error (group_id=%): %', NEW.group_id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_group_position_result_change ON public.group_position_results;
CREATE TRIGGER trigger_group_position_result_change
  AFTER INSERT OR UPDATE ON public.group_position_results
  FOR EACH ROW EXECUTE PROCEDURE public.on_group_position_result_change();

-- =============================================================
-- D) Fix recalculate_user_scores: aggregate group position points
--    properly (SUM, not single-row subquery) and update the
--    group_position_points column in scores.
-- =============================================================
CREATE OR REPLACE FUNCTION public.recalculate_user_scores(p_user_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.scores (
    user_id, match_points, group_position_points, exact_count, partial_count,
    wrong_count, total_predicted, accuracy_pct, total_points
  )
  SELECT
    p.user_id,
    -- match_points
    COALESCE(SUM(p.points), 0),
    -- group_position_points
    COALESCE((
      SELECT SUM(gpp.points)
      FROM public.group_position_predictions gpp
      WHERE gpp.user_id = p.user_id AND gpp.calculated_at IS NOT NULL
    ), 0),
    -- exact_count
    COUNT(*) FILTER (WHERE p.is_exact),
    -- partial_count
    COUNT(*) FILTER (WHERE p.is_partial),
    -- wrong_count
    COUNT(*) FILTER (WHERE p.points = 0 AND p.calculated_at IS NOT NULL AND p.home_score >= 0),
    -- total_predicted
    COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0),
    -- accuracy_pct
    CASE
      WHEN COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE p.is_exact OR p.is_partial)::DECIMAL
        / COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0) * 100,
        2
      )
      ELSE 0
    END,
    -- total_points
    COALESCE(SUM(p.points), 0)
      + COALESCE((
          SELECT SUM(gpp.points)
          FROM public.group_position_predictions gpp
          WHERE gpp.user_id = p.user_id AND gpp.calculated_at IS NOT NULL
        ), 0)
      + COALESCE((
          SELECT tp.champion_points + tp.runner_up_points
               + tp.finalist_1_points + tp.finalist_2_points + tp.top_scorer_points
          FROM public.tournament_predictions tp
          WHERE tp.user_id = p.user_id
        ), 0)
  FROM public.predictions p
  WHERE p.user_id = ANY(p_user_ids)
  GROUP BY p.user_id
  ON CONFLICT (user_id) DO UPDATE SET
    match_points          = EXCLUDED.match_points,
    group_position_points = EXCLUDED.group_position_points,
    exact_count           = EXCLUDED.exact_count,
    partial_count         = EXCLUDED.partial_count,
    wrong_count           = EXCLUDED.wrong_count,
    total_predicted       = EXCLUDED.total_predicted,
    accuracy_pct          = EXCLUDED.accuracy_pct,
    total_points          = EXCLUDED.total_points,
    updated_at            = NOW();
END;
$$;

-- =============================================================
-- E) Update admin_recalculate_all_scores to also handle group
--    position points for all groups.
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_recalculate_all_scores()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_user_ids UUID[];
  v_group_id INTEGER;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Forbidden: superadmin only';
  END IF;

  -- 1. Recalculate match prediction points
  UPDATE public.predictions p SET
    points = public.calculate_match_points(
      m.round, p.home_score, p.away_score, r.home_score, r.away_score
    ),
    is_exact = (
      p.home_score = r.home_score AND p.away_score = r.away_score
      AND p.home_score >= 0 AND p.away_score >= 0
    ),
    is_partial = (
      p.home_score >= 0 AND p.away_score >= 0
      AND NOT (p.home_score = r.home_score AND p.away_score = r.away_score)
      AND (
        CASE WHEN p.home_score > p.away_score THEN 'H'
             WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END
        =
        CASE WHEN r.home_score > r.away_score THEN 'H'
             WHEN r.home_score < r.away_score THEN 'A' ELSE 'D' END
      )
    ),
    calculated_at = NOW()
  FROM public.matches m
  JOIN public.match_results r ON r.match_id = m.id
  WHERE p.match_id = m.id;

  -- 2. Recalculate tournament bonus for all users
  PERFORM public.recalculate_all_tournament_bonus();

  -- 3. Recalculate group position points for every group with official results
  FOR v_group_id IN
    SELECT group_id FROM public.group_position_results
  LOOP
    PERFORM public.recalculate_group_position_points_for_group(v_group_id);
  END LOOP;

  -- 4. Gather all affected users
  SELECT ARRAY_AGG(DISTINCT u.user_id) INTO v_user_ids
  FROM (
    SELECT user_id FROM public.predictions             WHERE calculated_at IS NOT NULL
    UNION
    SELECT user_id FROM public.tournament_predictions
    UNION
    SELECT user_id FROM public.group_position_predictions WHERE calculated_at IS NOT NULL
  ) u;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);

    DELETE FROM public.user_achievements
    WHERE user_id = ANY(v_user_ids)
      AND achievement_id IN (
        SELECT id FROM public.achievements WHERE threshold IS NOT NULL
      );

    PERFORM public.check_and_award_achievements(v_user_ids);
  END IF;

  RETURN 'OK: scores and all bonus recalculated for '
         || COALESCE(array_length(v_user_ids, 1), 0) || ' users';
END;
$func$;
