-- =============================================================
-- MIGRATION: Correct teams and group assignments (2026 draw)
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- WARNING: This deletes all group-stage predictions, match results,
-- standings, and group-position predictions, then regenerates the
-- 72 group-stage matches with the correct squads.
-- Tournament predictions are preserved where possible (team refs
-- pointing to deleted teams are set to NULL).
-- =============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Clear data that depends on group-stage matches / teams
-- ─────────────────────────────────────────────────────────────

-- Remove group-position predictions entirely (groups change completely)
DELETE FROM public.group_position_predictions;

-- NULL-out tournament prediction references to teams being deleted
UPDATE public.tournament_predictions
SET
  champion_team_id   = CASE WHEN champion_team_id   IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE champion_team_id   END,
  runner_up_team_id  = CASE WHEN runner_up_team_id  IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE runner_up_team_id  END,
  finalist_2_team_id = CASE WHEN finalist_2_team_id IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE finalist_2_team_id END,
  top_scorer_team_id = CASE WHEN top_scorer_team_id IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE top_scorer_team_id END;

-- NULL-out tournament results references to teams being deleted
UPDATE public.tournament_results
SET
  champion_team_id    = CASE WHEN champion_team_id    IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE champion_team_id    END,
  runner_up_team_id   = CASE WHEN runner_up_team_id   IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE runner_up_team_id   END,
  third_place_team_id = CASE WHEN third_place_team_id IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE third_place_team_id END,
  top_scorer_team_id  = CASE WHEN top_scorer_team_id  IN (SELECT id FROM public.teams WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE')) THEN NULL ELSE top_scorer_team_id  END;

-- Delete match results for group stage (cascade from matches)
DELETE FROM public.match_results mr
USING public.matches m
WHERE mr.match_id = m.id AND m.round = 'group';

-- Delete group-stage match predictions
DELETE FROM public.predictions p
USING public.matches m
WHERE p.match_id = m.id AND m.round = 'group';

-- Delete group-stage matches
DELETE FROM public.matches WHERE round = 'group';

-- Delete standings
DELETE FROM public.standings;

-- Delete group_teams
DELETE FROM public.group_teams;

-- ─────────────────────────────────────────────────────────────
-- 2. Update teams that remain but have name/flag changes
-- ─────────────────────────────────────────────────────────────
UPDATE public.teams SET name = 'Arabia Saudita' WHERE code = 'KSA';

-- ─────────────────────────────────────────────────────────────
-- 3. Delete teams no longer in the tournament
-- ─────────────────────────────────────────────────────────────
DELETE FROM public.teams
WHERE code IN ('POL','VEN','SRB','CHI','ITA','JAM','DEN','CMR','NGA','HON','UAE');

-- ─────────────────────────────────────────────────────────────
-- 4. Insert new teams
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.teams (code, name, flag) VALUES
  ('CZE', 'República Checa',      '🇨🇿'),
  ('BIH', 'Bosnia y Herzegovina', '🇧🇦'),
  ('HAI', 'Haití',                '🇭🇹'),
  ('CUW', 'Curazao',              '🇨🇼'),
  ('SWE', 'Suecia',               '🇸🇪'),
  ('TUN', 'Túnez',                '🇹🇳'),
  ('CPV', 'Cabo Verde',           '🇨🇻'),
  ('NOR', 'Noruega',              '🇳🇴'),
  ('IRQ', 'Irak',                 '🇮🇶'),
  ('JOR', 'Jordania',             '🇯🇴'),
  ('COD', 'RD Congo',             '🇨🇩')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 5. Rebuild group_teams
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  team_codes TEXT[][];
  i INTEGER;
BEGIN
  team_codes := ARRAY[
    ARRAY['A','MEX','RSA','KOR','CZE'],
    ARRAY['B','CAN','BIH','QAT','SUI'],
    ARRAY['C','BRA','MAR','HAI','SCO'],
    ARRAY['D','USA','PAR','AUS','TUR'],
    ARRAY['E','GER','CUW','CIV','ECU'],
    ARRAY['F','NED','JPN','SWE','TUN'],
    ARRAY['G','BEL','EGY','IRN','NZL'],
    ARRAY['H','ESP','CPV','KSA','URU'],
    ARRAY['I','FRA','SEN','NOR','IRQ'],
    ARRAY['J','ARG','ALG','AUT','JOR'],
    ARRAY['K','POR','COD','UZB','COL'],
    ARRAY['L','ENG','CRO','GHA','PAN']
  ];

  FOR i IN 1..12 LOOP
    INSERT INTO public.group_teams (group_id, team_id)
    SELECT g.id, t.id
    FROM public.groups g, public.teams t
    WHERE g.letter = team_codes[i][1]
      AND t.code IN (team_codes[i][2], team_codes[i][3], team_codes[i][4], team_codes[i][5]);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 6. Regenerate group-stage matches (72 matches)
--    Pattern per group (T1=pos1…T4=pos4, ordered by team.id):
--    MD1: T1 vs T2,  T3 vs T4
--    MD2: T1 vs T3,  T2 vs T4
--    MD3: T1 vs T4,  T2 vs T3
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_groups    TEXT[]  := ARRAY['A','B','C','D','E','F','G','H','I','J','K','L'];
  v_letter    TEXT;
  v_gid       INTEGER;
  v_teams     INTEGER[];
  v_base_date TIMESTAMPTZ := '2026-06-11 18:00:00+00'::TIMESTAMPTZ;
  v_offset    INTEGER := 0;
  v_pairs     INTEGER[][] := ARRAY[
    ARRAY[1,2], ARRAY[3,4],
    ARRAY[1,3], ARRAY[2,4],
    ARRAY[1,4], ARRAY[2,3]
  ];
  v_matchdays INTEGER[] := ARRAY[1,1,2,2,3,3];
  j INTEGER;
BEGIN
  FOREACH v_letter IN ARRAY v_groups LOOP
    SELECT id INTO v_gid FROM public.groups WHERE letter = v_letter;

    SELECT ARRAY_AGG(t.id ORDER BY t.id)
    INTO v_teams
    FROM public.group_teams gt
    JOIN public.teams t ON t.id = gt.team_id
    WHERE gt.group_id = v_gid;

    FOR j IN 1..6 LOOP
      INSERT INTO public.matches (round, group_id, home_team_id, away_team_id, match_datetime, matchday, sort_order)
      VALUES (
        'group',
        v_gid,
        v_teams[v_pairs[j][1]],
        v_teams[v_pairs[j][2]],
        v_base_date + (v_offset * INTERVAL '6 hours'),
        v_matchdays[j],
        v_offset
      );
      v_offset := v_offset + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 7. Rebuild standings (all zeros)
-- ─────────────────────────────────────────────────────────────
INSERT INTO public.standings (group_id, team_id)
SELECT gt.group_id, gt.team_id
FROM public.group_teams gt
ON CONFLICT (group_id, team_id) DO NOTHING;

COMMIT;
