-- =============================================================
-- FIX: Retroactive scoring for predictions made after results
--
-- Problem: When a user makes a prediction AFTER the match result
-- is already in match_results, the scoring trigger doesn't fire
-- (it fires on match_results changes, not predictions changes).
-- This means pred.calculated_at stays NULL and pts = 0 in DB.
--
-- The frontend now shows client-side computed pts as a fallback,
-- but this migration ensures DB values are also correct.
-- =============================================================

-- A) Trigger: when a prediction is inserted or updated, check if
--    the match already has a result and score it immediately.
CREATE OR REPLACE FUNCTION public.score_prediction_on_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_round  TEXT;
  v_rh     INTEGER;
  v_ra     INTEGER;
BEGIN
  -- Only process if the user has made a real prediction (not -1)
  IF NEW.home_score < 0 OR NEW.away_score < 0 THEN
    RETURN NEW;
  END IF;

  -- Get the match round
  SELECT m.round INTO v_round
  FROM public.matches m
  WHERE m.id = NEW.match_id;

  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Check if this match already has an official result
  SELECT mr.home_score, mr.away_score INTO v_rh, v_ra
  FROM public.match_results mr
  WHERE mr.match_id = NEW.match_id;

  -- No result yet → nothing to score
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- Calculate and persist points
  NEW.points := public.calculate_match_points(
    v_round, NEW.home_score, NEW.away_score, v_rh, v_ra
  );
  NEW.is_exact := (NEW.home_score = v_rh AND NEW.away_score = v_ra);
  NEW.is_partial := (
    NOT (NEW.home_score = v_rh AND NEW.away_score = v_ra)
    AND (
      CASE WHEN NEW.home_score > NEW.away_score THEN 'H'
           WHEN NEW.home_score < NEW.away_score THEN 'A' ELSE 'D' END
      =
      CASE WHEN v_rh > v_ra THEN 'H'
           WHEN v_rh < v_ra THEN 'A' ELSE 'D' END
    )
  );
  NEW.calculated_at := NOW();

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'score_prediction_on_insert error (match_id=%): % — %',
    NEW.match_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_score_prediction_on_insert ON public.predictions;
CREATE TRIGGER trigger_score_prediction_on_insert
  BEFORE INSERT OR UPDATE OF home_score, away_score ON public.predictions
  FOR EACH ROW EXECUTE PROCEDURE public.score_prediction_on_insert();

-- B) One-time backfill: score all existing predictions that have
--    a result but no calculated_at (from the reset or late entry)
UPDATE public.predictions p
SET
  points = public.calculate_match_points(
    m.round,
    p.home_score, p.away_score,
    mr.home_score, mr.away_score
  ),
  is_exact = (p.home_score = mr.home_score AND p.away_score = mr.away_score),
  is_partial = (
    NOT (p.home_score = mr.home_score AND p.away_score = mr.away_score)
    AND (
      CASE WHEN p.home_score > p.away_score   THEN 'H'
           WHEN p.home_score < p.away_score   THEN 'A' ELSE 'D' END
      =
      CASE WHEN mr.home_score > mr.away_score THEN 'H'
           WHEN mr.home_score < mr.away_score THEN 'A' ELSE 'D' END
    )
  ),
  calculated_at = NOW()
FROM public.matches m
JOIN public.match_results mr ON mr.match_id = m.id
WHERE p.match_id = m.id
  AND p.home_score >= 0
  AND p.away_score >= 0
  AND (p.calculated_at IS NULL OR p.points = 0 AND NOT p.is_exact AND NOT p.is_partial);
