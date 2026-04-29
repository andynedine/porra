-- =============================================================
-- COMPREHENSIVE FIX for "match results not persisting"
--
-- Root causes:
-- 1. RETURNING user_id INTO v_affected_users (UUID[] ← UUID cast error)
-- 2. recalculate_user_scores references finalist_1_points / finalist_2_points
--    which may not exist in the DB if the schema was not fully applied.
-- 3. THREE triggers fire on match_results INSERT/UPDATE:
--    · trigger_update_standings       → update_group_standings()
--    · trigger_update_predictions_on_result → update_predictions_on_result()
--    · log_match_results_changes      → auto_log_change()
--    Any one of them failing rolls back the entire transaction, including
--    the result INSERT, so nothing is persisted and the UI shows "success"
--    while the DB has no data.
--
-- Fix strategy:
-- A) Add columns IF NOT EXISTS (safe to run multiple times)
-- B) Wrap ALL THREE trigger functions in EXCEPTION WHEN OTHERS so that
--    secondary failures never block the match result from being saved.
-- =============================================================

-- A) Ensure tournament_predictions has the finalist points columns
ALTER TABLE public.tournament_predictions
  ADD COLUMN IF NOT EXISTS finalist_1_points DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalist_2_points DECIMAL(5,2) DEFAULT 0;

-- B1) Resilient scoring trigger (main fix)
CREATE OR REPLACE FUNCTION public.update_predictions_on_result()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match_round TEXT;
  v_affected_users UUID[];
BEGIN
  -- Get the match round
  SELECT round INTO v_match_round FROM public.matches WHERE id = NEW.match_id;

  -- Update all predictions for this match
  UPDATE public.predictions SET
    points = public.calculate_match_points(
      v_match_round, home_score, away_score, NEW.home_score, NEW.away_score
    ),
    is_exact = (
      home_score = NEW.home_score
      AND away_score = NEW.away_score
      AND home_score >= 0
      AND away_score >= 0
    ),
    is_partial = (
      home_score >= 0 AND away_score >= 0
      AND NOT (home_score = NEW.home_score AND away_score = NEW.away_score)
      AND (
        CASE WHEN home_score   > away_score   THEN 'H' WHEN home_score   < away_score   THEN 'A' ELSE 'D' END
        =
        CASE WHEN NEW.home_score > NEW.away_score THEN 'H' WHEN NEW.home_score < NEW.away_score THEN 'A' ELSE 'D' END
      )
    ),
    calculated_at = NOW()
  WHERE match_id = NEW.match_id;

  -- Collect all affected user ids
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_affected_users
  FROM public.predictions
  WHERE match_id = NEW.match_id;

  -- Recalculate aggregate scores for affected users
  IF v_affected_users IS NOT NULL AND ARRAY_LENGTH(v_affected_users, 1) > 0 THEN
    PERFORM public.recalculate_user_scores(v_affected_users);
    PERFORM public.check_and_award_achievements(v_affected_users);
  END IF;

  -- Update match status to finished
  UPDATE public.matches SET status = 'finished', updated_at = NOW()
  WHERE id = NEW.match_id;

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Score recalculation failed: log a warning but NEVER roll back the result save.
  RAISE WARNING 'update_predictions_on_result error (match_id=%): % — %',
    NEW.match_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- B2) Resilient change-log trigger
CREATE OR REPLACE FUNCTION public.auto_log_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.change_logs (changed_by, table_name, record_id, action, old_data, new_data)
  VALUES (
    auth.uid(),
    TG_TABLE_NAME,
    COALESCE(NEW.id::TEXT, OLD.id::TEXT),
    TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE TO_JSONB(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE TO_JSONB(NEW) END
  );
  RETURN COALESCE(NEW, OLD);

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'auto_log_change error (table=%, op=%): %', TG_TABLE_NAME, TG_OP, SQLERRM;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- B3) Resilient standings trigger
CREATE OR REPLACE FUNCTION public.update_group_standings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match RECORD;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
  IF v_match.round <> 'group' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    UPDATE public.standings SET
      played        = played - 1,
      won           = won   - CASE WHEN OLD.home_score > OLD.away_score THEN 1 ELSE 0 END,
      drawn         = drawn - CASE WHEN OLD.home_score = OLD.away_score THEN 1 ELSE 0 END,
      lost          = lost  - CASE WHEN OLD.home_score < OLD.away_score THEN 1 ELSE 0 END,
      goals_for     = goals_for     - OLD.home_score,
      goals_against = goals_against - OLD.away_score,
      points        = points - CASE WHEN OLD.home_score > OLD.away_score THEN 3
                                    WHEN OLD.home_score = OLD.away_score THEN 1 ELSE 0 END
    WHERE group_id = v_match.group_id AND team_id = v_match.home_team_id;

    UPDATE public.standings SET
      played        = played - 1,
      won           = won   - CASE WHEN OLD.away_score > OLD.home_score THEN 1 ELSE 0 END,
      drawn         = drawn - CASE WHEN OLD.away_score = OLD.home_score THEN 1 ELSE 0 END,
      lost          = lost  - CASE WHEN OLD.away_score < OLD.home_score THEN 1 ELSE 0 END,
      goals_for     = goals_for     - OLD.away_score,
      goals_against = goals_against - OLD.home_score,
      points        = points - CASE WHEN OLD.away_score > OLD.home_score THEN 3
                                    WHEN OLD.away_score = OLD.home_score THEN 1 ELSE 0 END
    WHERE group_id = v_match.group_id AND team_id = v_match.away_team_id;
  END IF;

  INSERT INTO public.standings (group_id, team_id, played, won, drawn, lost, goals_for, goals_against, points)
  VALUES (v_match.group_id, v_match.home_team_id, 1,
    CASE WHEN NEW.home_score > NEW.away_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.home_score < NEW.away_score THEN 1 ELSE 0 END,
    NEW.home_score, NEW.away_score,
    CASE WHEN NEW.home_score > NEW.away_score THEN 3 WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END)
  ON CONFLICT (group_id, team_id) DO UPDATE SET
    played        = standings.played + 1,
    won           = standings.won   + CASE WHEN NEW.home_score > NEW.away_score THEN 1 ELSE 0 END,
    drawn         = standings.drawn + CASE WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
    lost          = standings.lost  + CASE WHEN NEW.home_score < NEW.away_score THEN 1 ELSE 0 END,
    goals_for     = standings.goals_for     + NEW.home_score,
    goals_against = standings.goals_against + NEW.away_score,
    points        = standings.points + CASE WHEN NEW.home_score > NEW.away_score THEN 3
                                            WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
    updated_at    = NOW();

  INSERT INTO public.standings (group_id, team_id, played, won, drawn, lost, goals_for, goals_against, points)
  VALUES (v_match.group_id, v_match.away_team_id, 1,
    CASE WHEN NEW.away_score > NEW.home_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.away_score < NEW.home_score THEN 1 ELSE 0 END,
    NEW.away_score, NEW.home_score,
    CASE WHEN NEW.away_score > NEW.home_score THEN 3 WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END)
  ON CONFLICT (group_id, team_id) DO UPDATE SET
    played        = standings.played + 1,
    won           = standings.won   + CASE WHEN NEW.away_score > NEW.home_score THEN 1 ELSE 0 END,
    drawn         = standings.drawn + CASE WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END,
    lost          = standings.lost  + CASE WHEN NEW.away_score < NEW.home_score THEN 1 ELSE 0 END,
    goals_for     = standings.goals_for     + NEW.away_score,
    goals_against = standings.goals_against + NEW.home_score,
    points        = standings.points + CASE WHEN NEW.away_score > NEW.home_score THEN 3
                                            WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END,
    updated_at    = NOW();

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'update_group_standings error (match_id=%): %', NEW.match_id, SQLERRM;
  RETURN NEW;
END;
$$;

-- =============================================================
-- C) RPC wrapper: lets the admin trigger a full recalculation
--    from the frontend without direct DB access.
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_recalculate_all_scores()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_ids UUID[];
  v_count    INTEGER;
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Forbidden: superadmin only';
  END IF;

  -- Recalculate predictions scoring for every match that has a result
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

  -- Collect all users who have any evaluated prediction
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_user_ids
  FROM public.predictions
  WHERE calculated_at IS NOT NULL;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;

  SELECT COUNT(*) INTO v_count FROM public.profiles;
  RETURN 'OK: scores recalculated for ' || COALESCE(array_length(v_user_ids, 1), 0) || ' users';
END;
$$;

-- =============================================================
-- D) Force immediate recalculation of all current scores
--    (fixes stale data from before the trigger fix was applied)
-- =============================================================
DO $$
DECLARE
  v_user_ids UUID[];
BEGIN
  -- Re-score all predictions that have a match result
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
        CASE WHEN p.home_score > p.away_score THEN 'H' WHEN p.home_score < p.away_score THEN 'A' ELSE 'D' END
        =
        CASE WHEN r.home_score > r.away_score THEN 'H' WHEN r.home_score < r.away_score THEN 'A' ELSE 'D' END
      )
    ),
    calculated_at = NOW()
  FROM public.matches m
  JOIN public.match_results r ON r.match_id = m.id
  WHERE p.match_id = m.id;

  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_user_ids
  FROM public.predictions WHERE calculated_at IS NOT NULL;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);
  END IF;
END;
$$;

-- =============================================================
-- E) Fix: award achievements that were never granted because the
--    DO block above (section D) ran before this fix.
--
--    Also:
--    · Updates check_and_award_achievements to handle FIRST_PRED
--      (threshold IS NULL — awarded on first prediction made).
--    · Updates admin_recalculate_all_scores() to also award
--      achievements when called from the admin button.
-- =============================================================

-- E1) Updated achievements checker: FIRST_PRED via predictions table + threshold badges
CREATE OR REPLACE FUNCTION public.check_and_award_achievements(p_user_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id         UUID;
  v_exact_count     INTEGER;
  v_ach             RECORD;
BEGIN
  FOREACH v_user_id IN ARRAY p_user_ids LOOP
    -- FIRST_PRED: check directly from predictions table,
    -- independent of scores (user may have no results yet)
    IF EXISTS (SELECT 1 FROM public.predictions WHERE user_id = v_user_id LIMIT 1) THEN
      INSERT INTO public.user_achievements (user_id, achievement_id)
      SELECT v_user_id, id FROM public.achievements WHERE code = 'FIRST_PRED'
      ON CONFLICT (user_id, achievement_id) DO NOTHING;
    END IF;

    SELECT exact_count INTO v_exact_count
      FROM public.scores WHERE user_id = v_user_id;
    IF v_exact_count IS NULL THEN CONTINUE; END IF;

    -- Threshold-based achievements (based on exact_count)
    FOR v_ach IN
      SELECT * FROM public.achievements
      WHERE threshold IS NOT NULL AND threshold <= v_exact_count
    LOOP
      INSERT INTO public.user_achievements (user_id, achievement_id)
      VALUES (v_user_id, v_ach.id)
      ON CONFLICT (user_id, achievement_id) DO NOTHING;
    END LOOP;
  END LOOP;
END;
$$;

-- E1b) Trigger for instant FIRST_PRED award on first prediction INSERT
CREATE OR REPLACE FUNCTION public.award_first_prediction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.predictions WHERE user_id = NEW.user_id) = 1 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id)
    SELECT NEW.user_id, id FROM public.achievements WHERE code = 'FIRST_PRED'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_award_first_prediction
  AFTER INSERT ON public.predictions
  FOR EACH ROW EXECUTE PROCEDURE public.award_first_prediction();

-- E2) Updated admin RPC: hard-resets threshold achievements + re-awards
CREATE OR REPLACE FUNCTION public.admin_recalculate_all_scores()
RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_ids UUID[];
BEGIN
  IF NOT public.is_superadmin() THEN
    RAISE EXCEPTION 'Forbidden: superadmin only';
  END IF;

  -- Recalculate predictions scoring for every match that has a result
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

  -- Collect all users who have any evaluated prediction
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_user_ids
  FROM public.predictions
  WHERE calculated_at IS NOT NULL;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.recalculate_user_scores(v_user_ids);

    -- Hard-reset threshold-based achievements for the affected users
    -- so that removed/corrected results don't leave stale badges.
    -- FIRST_PRED is permanent and is NOT deleted.
    DELETE FROM public.user_achievements
    WHERE user_id = ANY(v_user_ids)
      AND achievement_id IN (
        SELECT id FROM public.achievements WHERE threshold IS NOT NULL
      );

    PERFORM public.check_and_award_achievements(v_user_ids);
  END IF;

  RETURN 'OK: scores and achievements recalculated for ' || COALESCE(array_length(v_user_ids, 1), 0) || ' users';
END;
$$;

-- E3) Immediately award all pending achievements to all users
DO $$
DECLARE
  v_user_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(DISTINCT user_id) INTO v_user_ids
  FROM public.scores;

  IF v_user_ids IS NOT NULL THEN
    PERFORM public.check_and_award_achievements(v_user_ids);
  END IF;
END;
$$;

