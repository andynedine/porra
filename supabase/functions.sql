-- =============================================================
-- PORRA MUNDIAL 2026 — SQL Functions & Triggers
-- Run AFTER schema.sql and rls.sql
-- =============================================================

-- =============================================================
-- 1. AUTO-CREATE PROFILE ON SIGNUP
-- =============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, username, phone, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'username', SPLIT_PART(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    'USER'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- =============================================================
-- 1b. CHECK EMAIL EXISTS (callable by anon for password reset)
-- =============================================================
CREATE OR REPLACE FUNCTION public.check_email_exists(email_input TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(email) = lower(email_input)
  );
$$;

GRANT EXECUTE ON FUNCTION public.check_email_exists(TEXT) TO anon, authenticated;

-- =============================================================
-- 2. UPDATE profiles.updated_at ON CHANGE
-- =============================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

CREATE OR REPLACE TRIGGER matches_updated_at
  BEFORE UPDATE ON public.matches
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

CREATE OR REPLACE TRIGGER predictions_updated_at
  BEFORE UPDATE ON public.predictions
  FOR EACH ROW EXECUTE PROCEDURE public.touch_updated_at();

-- =============================================================
-- 3. CORE SCORING FUNCTION
-- Returns points for a single match prediction
-- =============================================================
CREATE OR REPLACE FUNCTION public.calculate_match_points(
  p_round        TEXT,
  p_home_pred    INTEGER,
  p_away_pred    INTEGER,
  p_home_actual  INTEGER,
  p_away_actual  INTEGER
)
RETURNS DECIMAL(5,2) LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_points       DECIMAL(5,2) := 0;
  v_pred_result  TEXT;
  v_actual_result TEXT;
BEGIN
  -- Not predicted → 0 points
  IF p_home_pred = -1 OR p_away_pred = -1 THEN
    RETURN 0;
  END IF;

  -- Determine result direction (H = home wins, D = draw, A = away wins)
  v_pred_result   := CASE WHEN p_home_pred   > p_away_pred   THEN 'H'
                          WHEN p_home_pred   < p_away_pred   THEN 'A'
                          ELSE 'D' END;
  v_actual_result := CASE WHEN p_home_actual > p_away_actual THEN 'H'
                          WHEN p_home_actual < p_away_actual THEN 'A'
                          ELSE 'D' END;

  -- Exact score?
  IF p_home_pred = p_home_actual AND p_away_pred = p_away_actual THEN
    v_points := CASE p_round
      WHEN 'group'          THEN 2.0
      WHEN 'dieciseisavos'  THEN 2.5
      WHEN 'octavos'        THEN 2.5
      WHEN 'cuartos'        THEN 3.0
      WHEN 'semis'          THEN 3.0
      WHEN 'tercero'        THEN 4.0
      WHEN 'final'          THEN 4.0
      ELSE 2.0
    END;
  -- Correct result direction (partial)?
  ELSIF v_pred_result = v_actual_result THEN
    v_points := CASE p_round
      WHEN 'group'          THEN 1.0
      WHEN 'dieciseisavos'  THEN 1.5
      WHEN 'octavos'        THEN 1.5
      WHEN 'cuartos'        THEN 1.5
      WHEN 'semis'          THEN 1.5
      WHEN 'tercero'        THEN 2.0
      WHEN 'final'          THEN 2.0
      ELSE 1.0
    END;
  END IF;

  RETURN v_points;
END;
$$;

-- =============================================================
-- 4. RECALCULATE SCORES FOR A LIST OF USERS (from scratch)
-- =============================================================
CREATE OR REPLACE FUNCTION public.recalculate_user_scores(p_user_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
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
      + COALESCE((SELECT gpp.points FROM public.group_position_predictions gpp WHERE gpp.user_id = p.user_id), 0)
      + COALESCE((SELECT tp.champion_points + tp.runner_up_points + tp.finalist_1_points + tp.finalist_2_points + tp.top_scorer_points
                  FROM public.tournament_predictions tp WHERE tp.user_id = p.user_id), 0)
  FROM public.predictions p
  WHERE p.user_id = ANY(p_user_ids)
  GROUP BY p.user_id
  ON CONFLICT (user_id) DO UPDATE SET
    match_points      = EXCLUDED.match_points,
    exact_count       = EXCLUDED.exact_count,
    partial_count     = EXCLUDED.partial_count,
    wrong_count       = EXCLUDED.wrong_count,
    total_predicted   = EXCLUDED.total_predicted,
    accuracy_pct      = EXCLUDED.accuracy_pct,
    total_points      = EXCLUDED.total_points,
    updated_at        = NOW();
END;
$$;

-- =============================================================
-- 5. UPDATE GROUP STANDINGS ON RESULT INSERT/UPDATE
-- =============================================================
CREATE OR REPLACE FUNCTION public.update_group_standings()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_match RECORD;
BEGIN
  SELECT * INTO v_match FROM public.matches WHERE id = NEW.match_id;
  IF v_match.round <> 'group' THEN RETURN NEW; END IF;

  -- ---- HOME TEAM ----
  -- If UPDATE: subtract old contribution first
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

  -- Add new home contribution
  INSERT INTO public.standings (group_id, team_id, played, won, drawn, lost, goals_for, goals_against, points)
  VALUES (
    v_match.group_id, v_match.home_team_id, 1,
    CASE WHEN NEW.home_score > NEW.away_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.home_score < NEW.away_score THEN 1 ELSE 0 END,
    NEW.home_score, NEW.away_score,
    CASE WHEN NEW.home_score > NEW.away_score THEN 3
         WHEN NEW.home_score = NEW.away_score THEN 1 ELSE 0 END
  )
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

  -- Add new away contribution
  INSERT INTO public.standings (group_id, team_id, played, won, drawn, lost, goals_for, goals_against, points)
  VALUES (
    v_match.group_id, v_match.away_team_id, 1,
    CASE WHEN NEW.away_score > NEW.home_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END,
    CASE WHEN NEW.away_score < NEW.home_score THEN 1 ELSE 0 END,
    NEW.away_score, NEW.home_score,
    CASE WHEN NEW.away_score > NEW.home_score THEN 3
         WHEN NEW.away_score = NEW.home_score THEN 1 ELSE 0 END
  )
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

CREATE OR REPLACE TRIGGER trigger_update_standings
  AFTER INSERT OR UPDATE ON public.match_results
  FOR EACH ROW EXECUTE PROCEDURE public.update_group_standings();

-- =============================================================
-- 6. MAIN SCORING TRIGGER: Update predictions when result added
-- =============================================================
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
  RAISE WARNING 'update_predictions_on_result error (match_id=%): % — %',
    NEW.match_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_update_predictions_on_result
  AFTER INSERT OR UPDATE ON public.match_results
  FOR EACH ROW EXECUTE PROCEDURE public.update_predictions_on_result();

-- =============================================================
-- 7. GROUP POSITION POINTS CALCULATION
-- +0.5 per correct position; +3 if all 4 correct (perfect group)
-- =============================================================
CREATE OR REPLACE FUNCTION public.calculate_group_position_points(p_user_id UUID, p_group_id INTEGER)
RETURNS DECIMAL(5,2) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pred  RECORD;
  v_actual_standings RECORD;
  v_correct INTEGER := 0;
  v_points DECIMAL(5,2) := 0;
  v_actual_order INTEGER[];
BEGIN
  -- Get user's prediction
  SELECT * INTO v_pred
  FROM public.group_position_predictions
  WHERE user_id = p_user_id AND group_id = p_group_id;

  IF NOT FOUND THEN RETURN 0; END IF;

  -- Get actual standings (ordered by points DESC, goal_diff DESC, goals_for DESC)
  SELECT ARRAY_AGG(team_id ORDER BY points DESC, goal_diff DESC, goals_for DESC)
  INTO v_actual_order
  FROM public.standings
  WHERE group_id = p_group_id;

  IF v_actual_order IS NULL OR ARRAY_LENGTH(v_actual_order, 1) < 4 THEN RETURN 0; END IF;

  -- Count correct positions
  IF v_pred.pos_1_team_id = v_actual_order[1] THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_2_team_id = v_actual_order[2] THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_3_team_id = v_actual_order[3] THEN v_correct := v_correct + 1; END IF;
  IF v_pred.pos_4_team_id = v_actual_order[4] THEN v_correct := v_correct + 1; END IF;

  -- Apply scoring rules
  IF v_correct = 4 THEN
    v_points := 3.0;  -- perfect group bonus
  ELSE
    v_points := v_correct * 0.5;
  END IF;

  -- Persist result
  UPDATE public.group_position_predictions
  SET points = v_points, calculated_at = NOW()
  WHERE user_id = p_user_id AND group_id = p_group_id;

  RETURN v_points;
END;
$$;

-- =============================================================
-- 8. TOURNAMENT BONUS POINTS CALCULATION
-- Champion: +10, Finalists (A+B reach the final): +3 each, Top scorer: +10
-- =============================================================
CREATE OR REPLACE FUNCTION public.calculate_tournament_bonus_points(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pred RECORD;
  v_result RECORD;
  v_champion_pts   DECIMAL(5,2) := 0;
  v_runner_up_pts  DECIMAL(5,2) := 0;
  v_finalist1_pts  DECIMAL(5,2) := 0;
  v_finalist2_pts  DECIMAL(5,2) := 0;
  v_top_scorer_pts DECIMAL(5,2) := 0;
BEGIN
  SELECT * INTO v_pred   FROM public.tournament_predictions WHERE user_id = p_user_id;
  SELECT * INTO v_result FROM public.tournament_results LIMIT 1;

  IF NOT FOUND OR v_result IS NULL THEN RETURN; END IF;

  -- Champion (+10)
  IF v_pred.champion_team_id = v_result.champion_team_id THEN
    v_champion_pts := 10.0;
  END IF;

  -- runner_up_points no longer used (kept as 0 for backward compat)
  v_runner_up_pts := 0;

  -- Finalist A reached the final (+3) — stored in runner_up_team_id column
  IF v_pred.runner_up_team_id IS NOT NULL
     AND v_pred.runner_up_team_id IN (v_result.champion_team_id, v_result.runner_up_team_id) THEN
    v_finalist1_pts := 3.0;
  END IF;

  -- Finalist B reached the final (+3) — stored in finalist_2_team_id column
  IF v_pred.finalist_2_team_id IS NOT NULL
     AND v_pred.finalist_2_team_id IN (v_result.champion_team_id, v_result.runner_up_team_id) THEN
    v_finalist2_pts := 3.0;
  END IF;

  -- Top scorer (+10)
  IF v_pred.top_scorer_name IS NOT NULL
     AND LOWER(TRIM(v_pred.top_scorer_name)) = LOWER(TRIM(v_result.top_scorer_name)) THEN
    v_top_scorer_pts := 10.0;
  END IF;

  UPDATE public.tournament_predictions SET
    champion_points   = v_champion_pts,
    runner_up_points  = v_runner_up_pts,
    finalist_1_points = v_finalist1_pts,
    finalist_2_points = v_finalist2_pts,
    top_scorer_points = v_top_scorer_pts,
    calculated_at     = NOW()
  WHERE user_id = p_user_id;
END;
$$;

-- =============================================================
-- 9. ACHIEVEMENTS CHECKER
-- Triggered after score recalculation
-- =============================================================
CREATE OR REPLACE FUNCTION public.check_and_award_achievements(p_user_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_id        UUID;
  v_exact_count    INTEGER;
  v_ach            RECORD;
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

-- Award FIRST_PRED immediately when a user inserts their first prediction
CREATE OR REPLACE FUNCTION public.award_first_prediction()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- Only run once per user (their very first prediction)
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

-- =============================================================
-- 10. CHANGE LOG WRITER (called manually from admin operations)
-- =============================================================
CREATE OR REPLACE FUNCTION public.log_change(
  p_table    TEXT,
  p_record   TEXT,
  p_action   TEXT,
  p_old      JSONB,
  p_new      JSONB
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.change_logs (changed_by, table_name, record_id, action, old_data, new_data)
  VALUES (auth.uid(), p_table, p_record, p_action, p_old, p_new);
END;
$$;

-- Trigger to auto-log changes on match_results and predictions
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

CREATE OR REPLACE TRIGGER log_match_results_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.match_results
  FOR EACH ROW EXECUTE PROCEDURE public.auto_log_change();

CREATE OR REPLACE TRIGGER log_predictions_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.predictions
  FOR EACH ROW EXECUTE PROCEDURE public.auto_log_change();

-- =============================================================
-- 11. RANKING VIEW (public — convenient for frontend queries)
-- =============================================================
CREATE OR REPLACE VIEW public.ranking AS
SELECT
  ROW_NUMBER() OVER (ORDER BY s.total_points DESC, s.exact_count DESC, s.accuracy_pct DESC) AS rank,
  p.id            AS user_id,
  p.username,
  p.avatar_url,
  s.total_points,
  s.match_points,
  s.group_position_points,
  s.tournament_points,
  s.exact_count,
  s.partial_count,
  s.wrong_count,
  s.total_predicted,
  s.accuracy_pct
FROM public.scores s
JOIN public.profiles p ON p.id = s.user_id
ORDER BY s.total_points DESC, s.exact_count DESC, s.accuracy_pct DESC;

-- =============================================================
-- 12. ROUND-SPECIFIC RANKING (function for parameterised query)
-- =============================================================
CREATE OR REPLACE FUNCTION public.get_round_ranking(p_round TEXT)
RETURNS TABLE (
  rank           BIGINT,
  user_id        UUID,
  username       TEXT,
  avatar_url     TEXT,
  round_points   DECIMAL,
  exact_count    BIGINT,
  partial_count  BIGINT
) LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY SUM(pr.points) DESC, COUNT(*) FILTER (WHERE pr.is_exact) DESC) AS rank,
    pr.user_id,
    pf.username,
    pf.avatar_url,
    SUM(pr.points)                                        AS round_points,
    COUNT(*) FILTER (WHERE pr.is_exact)                   AS exact_count,
    COUNT(*) FILTER (WHERE pr.is_partial)                 AS partial_count
  FROM public.predictions pr
  JOIN public.matches m  ON m.id  = pr.match_id
  JOIN public.profiles pf ON pf.id = pr.user_id
  WHERE m.round = p_round
    AND pr.calculated_at IS NOT NULL
  GROUP BY pr.user_id, pf.username, pf.avatar_url
  ORDER BY round_points DESC;
$$;

-- =============================================================
-- 13. ENSURE SCORES ROW EXISTS FOR EVERY PROFILE
-- =============================================================
CREATE OR REPLACE FUNCTION public.ensure_score_row()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.scores (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER ensure_user_score
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE PROCEDURE public.ensure_score_row();
