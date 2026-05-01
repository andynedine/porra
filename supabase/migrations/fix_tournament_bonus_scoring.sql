-- =============================================================
-- fix_tournament_bonus_scoring.sql
-- 1. Redefine calculate_tournament_bonus_points with correct rules.
-- 2. Trigger en tournament_results → recalcula bonus al guardar.
-- 3. Actualiza admin_recalculate_all_scores para calcular bonus.
-- =============================================================

-- ---------------------------------------------------------------
-- PRE) Redefine calculate_tournament_bonus_points with explicit rules:
--   · Campeón acertado              → +10 pts
--   · Finalista A llega a la final  → +3 pts (si está entre campeón o subcampeón)
--   · Finalista B llega a la final  → +3 pts (si está entre campeón o subcampeón)
--   · Máximo goleador acertado      → +10 pts
--
-- Columnas en tournament_predictions:
--   champion_team_id   → elección de campeón del usuario
--   runner_up_team_id  → Finalista A del usuario
--   finalist_2_team_id → Finalista B del usuario
--
-- Columnas en tournament_results (introducidas por SUPERADMIN):
--   champion_team_id   → campeón real
--   runner_up_team_id  → subcampeón real
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_tournament_bonus_points(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_pred   RECORD;
  v_result RECORD;
  v_champion_pts   DECIMAL(5,2) := 0;
  v_finalist1_pts  DECIMAL(5,2) := 0;
  v_finalist2_pts  DECIMAL(5,2) := 0;
  v_top_scorer_pts DECIMAL(5,2) := 0;
  v_pred_found   BOOLEAN := FALSE;
  v_result_found BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_pred FROM public.tournament_predictions WHERE user_id = p_user_id;
  v_pred_found := FOUND;

  SELECT * INTO v_result FROM public.tournament_results LIMIT 1;
  v_result_found := FOUND;

  -- Nothing to do if user has no prediction or admin hasn't entered results yet
  IF NOT v_pred_found OR NOT v_result_found THEN RETURN; END IF;

  -- Campeón (+10): usuario acertó el campeón exacto
  IF v_pred.champion_team_id IS NOT NULL
     AND v_pred.champion_team_id = v_result.champion_team_id THEN
    v_champion_pts := 10.0;
  END IF;

  -- Finalista A (+3): el equipo elegido como Finalista A
  -- llegó a la final (es campeón O subcampeón)
  IF v_pred.runner_up_team_id IS NOT NULL
     AND v_result.champion_team_id IS NOT NULL
     AND v_result.runner_up_team_id IS NOT NULL
     AND v_pred.runner_up_team_id IN (v_result.champion_team_id, v_result.runner_up_team_id) THEN
    v_finalist1_pts := 3.0;
  END IF;

  -- Finalista B (+3): el equipo elegido como Finalista B
  -- llegó a la final (es campeón O subcampeón)
  IF v_pred.finalist_2_team_id IS NOT NULL
     AND v_result.champion_team_id IS NOT NULL
     AND v_result.runner_up_team_id IS NOT NULL
     AND v_pred.finalist_2_team_id IN (v_result.champion_team_id, v_result.runner_up_team_id) THEN
    v_finalist2_pts := 3.0;
  END IF;

  -- Máximo goleador (+10): coincidencia exacta (case-insensitive, sin espacios extra)
  IF v_pred.top_scorer_name IS NOT NULL
     AND v_result.top_scorer_name IS NOT NULL
     AND LOWER(TRIM(v_pred.top_scorer_name)) = LOWER(TRIM(v_result.top_scorer_name)) THEN
    v_top_scorer_pts := 10.0;
  END IF;

  UPDATE public.tournament_predictions SET
    champion_points   = v_champion_pts,
    runner_up_points  = 0,             -- no longer used, kept for compat
    finalist_1_points = v_finalist1_pts,
    finalist_2_points = v_finalist2_pts,
    top_scorer_points = v_top_scorer_pts,
    calculated_at     = NOW()
  WHERE user_id = p_user_id;
END;
$func$;

-- ---------------------------------------------------------------
-- A0) Patch recalculate_user_scores to also write
--     tournament_points and group_position_points separately,
--     and use per-column COALESCE to avoid NULL-sum zeroing.
--     Uses separate UPDATE steps to avoid parser issues with
--     correlated subqueries inside INSERT...SELECT...GROUP BY.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_user_scores(p_user_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
  -- Step 1: Upsert match-based stats
  INSERT INTO public.scores (
    user_id, match_points, exact_count, partial_count,
    wrong_count, total_predicted, accuracy_pct, total_points
  )
  SELECT
    p.user_id,
    COALESCE(SUM(p.points), 0),
    COUNT(*) FILTER (WHERE p.is_exact),
    COUNT(*) FILTER (WHERE p.is_partial),
    COUNT(*) FILTER (WHERE p.points = 0 AND p.calculated_at IS NOT NULL AND p.home_score >= 0),
    COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0),
    CASE
      WHEN COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0) > 0
      THEN ROUND(
        COUNT(*) FILTER (WHERE p.is_exact OR p.is_partial)::DECIMAL
        / COUNT(*) FILTER (WHERE p.calculated_at IS NOT NULL AND p.home_score >= 0) * 100,
        2
      )
      ELSE 0
    END,
    COALESCE(SUM(p.points), 0)
  FROM public.predictions p
  WHERE p.user_id = ANY(p_user_ids)
  GROUP BY p.user_id
  ON CONFLICT (user_id) DO UPDATE SET
    match_points    = EXCLUDED.match_points,
    exact_count     = EXCLUDED.exact_count,
    partial_count   = EXCLUDED.partial_count,
    wrong_count     = EXCLUDED.wrong_count,
    total_predicted = EXCLUDED.total_predicted,
    accuracy_pct    = EXCLUDED.accuracy_pct,
    updated_at      = NOW();

  -- Step 2: Update group_position_points
  UPDATE public.scores s
  SET group_position_points = COALESCE((
    SELECT SUM(gpp.points)
    FROM public.group_position_predictions gpp
    WHERE gpp.user_id = s.user_id
      AND gpp.calculated_at IS NOT NULL
  ), 0)
  WHERE s.user_id = ANY(p_user_ids);

  -- Step 3: Update tournament_points (COALESCE per column avoids NULL-sum)
  UPDATE public.scores s
  SET tournament_points = COALESCE((
    SELECT
      COALESCE(tp.champion_points,   0)
      + COALESCE(tp.runner_up_points,  0)
      + COALESCE(tp.finalist_1_points, 0)
      + COALESCE(tp.finalist_2_points, 0)
      + COALESCE(tp.top_scorer_points, 0)
    FROM public.tournament_predictions tp
    WHERE tp.user_id = s.user_id
  ), 0)
  WHERE s.user_id = ANY(p_user_ids);

  -- Step 4: Recompute total_points = match + group_position + tournament
  UPDATE public.scores
  SET total_points = match_points + group_position_points + tournament_points,
      updated_at   = NOW()
  WHERE user_id = ANY(p_user_ids);

END;
$func$;

-- ---------------------------------------------------------------
-- A) Función helper: recalcula bonus de torneo para TODOS los
--    usuarios que tengan una predicción de torneo.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_all_tournament_bonus()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_uid      UUID;
  v_user_ids UUID[];
BEGIN
  -- Recalcular bonus individualmente por usuario
  FOR v_uid IN SELECT user_id FROM public.tournament_predictions LOOP
    PERFORM public.calculate_tournament_bonus_points(v_uid);
  END LOOP;

  -- Refrescar la tabla scores para esos usuarios
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_user_ids
  FROM public.tournament_predictions;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);
  END IF;
END;
$func$;

-- ---------------------------------------------------------------
-- B) Trigger: se dispara al insertar o actualizar tournament_results
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_tournament_result_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $func$
BEGIN
  PERFORM public.recalculate_all_tournament_bonus();
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_tournament_result_change error: %', SQLERRM;
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trigger_tournament_result_change ON public.tournament_results;
CREATE TRIGGER trigger_tournament_result_change
  AFTER INSERT OR UPDATE ON public.tournament_results
  FOR EACH ROW EXECUTE PROCEDURE public.on_tournament_result_change();

-- ---------------------------------------------------------------
-- C) Actualizar admin_recalculate_all_scores para que también
--    calcule bonus de torneo antes de llamar recalculate_user_scores
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_recalculate_all_scores()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $func$
DECLARE
  v_user_ids UUID[];
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Forbidden: superadmin only';
  END IF;

  -- 1. Recalcular predicciones de partidos
  UPDATE public.predictions p SET
    points = public.calculate_match_points(
      m.round,
      p.home_score,
      p.away_score,
      r.home_score,
      r.away_score
    ),
    is_exact = (
      p.home_score = r.home_score AND p.away_score = r.away_score
      AND p.home_score >= 0 AND p.away_score >= 0
    ),
    is_partial = (
      p.home_score >= 0 AND p.away_score >= 0
      AND NOT (p.home_score = r.home_score AND p.away_score = r.away_score)
      AND (
        CASE WHEN p.home_score > p.away_score THEN 'H' WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END
        =
        CASE WHEN r.home_score > r.away_score THEN 'H' WHEN r.home_score < r.away_score THEN 'A' ELSE 'D' END
      )
    ),
    calculated_at = NOW()
  FROM public.matches m
  JOIN public.match_results r ON r.match_id = m.id
  WHERE p.match_id = m.id;

  -- 2. Recalcular bonus de torneo para todos los usuarios
  PERFORM public.recalculate_all_tournament_bonus();

  -- 3. Recopilar todos los usuarios a recalcular (partidos + torneo)
  SELECT ARRAY_AGG(DISTINCT u.user_id) INTO v_user_ids
  FROM (
    SELECT user_id FROM public.predictions WHERE calculated_at IS NOT NULL
    UNION
    SELECT user_id FROM public.tournament_predictions
  ) u;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);

    -- Reset logros de umbral para evitar badges obsoletos
    DELETE FROM public.user_achievements
    WHERE user_id = ANY(v_user_ids)
      AND achievement_id IN (
        SELECT id FROM public.achievements WHERE threshold IS NOT NULL
      );

    PERFORM public.check_and_award_achievements(v_user_ids);
  END IF;

  RETURN 'OK: scores and tournament bonus recalculated for '
         || COALESCE(array_length(v_user_ids, 1), 0) || ' users';
END;
$func$;
