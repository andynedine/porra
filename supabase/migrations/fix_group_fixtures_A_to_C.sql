-- =============================================================
-- MIGRATION: Fix match fixtures for groups A–C
-- All times are UTC.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

DO $$
DECLARE
  r RECORD;
  v_home_id  INTEGER;
  v_away_id  INTEGER;
  v_group_id INTEGER;
  v_rows     INTEGER;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    -- ── GRUPO A ──────────────────────────────────────────────
    ('A','MEX','RSA','2026-06-11 21:00:00+00'::TIMESTAMPTZ),
    ('A','KOR','CZE','2026-06-12 04:00:00+00'),
    ('A','CZE','RSA','2026-06-18 18:00:00+00'),
    ('A','MEX','KOR','2026-06-19 03:00:00+00'),
    ('A','CZE','MEX','2026-06-25 03:00:00+00'),
    ('A','RSA','KOR','2026-06-25 03:00:00+00'),
    -- ── GRUPO B ──────────────────────────────────────────────
    ('B','CAN','BIH','2026-06-12 21:00:00+00'),
    ('B','QAT','SUI','2026-06-13 21:00:00+00'),
    ('B','SUI','BIH','2026-06-18 21:00:00+00'),
    ('B','CAN','QAT','2026-06-19 00:00:00+00'),
    ('B','BIH','QAT','2026-06-24 21:00:00+00'),
    ('B','SUI','CAN','2026-06-24 21:00:00+00'),
    -- ── GRUPO C ──────────────────────────────────────────────
    ('C','BRA','MAR','2026-06-14 00:00:00+00'),
    ('C','HAI','SCO','2026-06-14 03:00:00+00'),
    ('C','SCO','MAR','2026-06-20 00:00:00+00'),
    ('C','BRA','HAI','2026-06-20 02:30:00+00'),
    ('C','SCO','BRA','2026-06-25 00:00:00+00'),
    ('C','MAR','HAI','2026-06-25 00:00:00+00')

  ) AS t(grp, home_code, away_code, new_dt)
  LOOP
    SELECT id INTO v_home_id  FROM public.teams WHERE code = r.home_code;
    SELECT id INTO v_away_id  FROM public.teams WHERE code = r.away_code;
    SELECT id INTO v_group_id FROM public.groups WHERE letter = r.grp;

    IF v_home_id IS NULL THEN
      RAISE WARNING 'Team not found: %', r.home_code; CONTINUE;
    END IF;
    IF v_away_id IS NULL THEN
      RAISE WARNING 'Team not found: %', r.away_code; CONTINUE;
    END IF;

    UPDATE public.matches
    SET
      home_team_id   = v_home_id,
      away_team_id   = v_away_id,
      match_datetime = r.new_dt
    WHERE round    = 'group'
      AND group_id = v_group_id
      AND home_team_id IN (v_home_id, v_away_id)
      AND away_team_id IN (v_home_id, v_away_id);

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE WARNING 'No match found for % vs % in group %', r.home_code, r.away_code, r.grp;
    ELSE
      RAISE NOTICE 'Updated: Group % — % vs % → %', r.grp, r.home_code, r.away_code, r.new_dt;
    END IF;
  END LOOP;
END;
$$;
