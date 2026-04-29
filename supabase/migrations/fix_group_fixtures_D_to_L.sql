-- =============================================================
-- MIGRATION: Fix match fixtures for groups D–L
-- Updates home_team_id, away_team_id and match_datetime
-- All times are UTC.
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- Safe to run multiple times (idempotent per match pair).
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
    -- ── GRUPO D ──────────────────────────────────────────────
    ('D','USA','PAR','2026-06-13 03:00:00+00'::TIMESTAMPTZ),
    ('D','AUS','TUR','2026-06-13 06:00:00+00'),
    ('D','PAR','AUS','2026-06-18 18:00:00+00'),
    ('D','TUR','USA','2026-06-19 03:00:00+00'),
    ('D','AUS','USA','2026-06-24 21:00:00+00'),
    ('D','PAR','TUR','2026-06-24 21:00:00+00'),
    -- ── GRUPO E ──────────────────────────────────────────────
    ('E','GER','CUW','2026-06-14 19:00:00+00'),
    ('E','CIV','ECU','2026-06-15 01:00:00+00'),
    ('E','GER','CIV','2026-06-20 22:00:00+00'),
    ('E','ECU','CUW','2026-06-21 02:00:00+00'),
    ('E','ECU','GER','2026-06-25 22:00:00+00'),
    ('E','CUW','CIV','2026-06-25 22:00:00+00'),
    -- ── GRUPO F ──────────────────────────────────────────────
    ('F','NED','JPN','2026-06-14 22:00:00+00'),
    ('F','SWE','TUN','2026-06-15 04:00:00+00'),
    ('F','NED','SWE','2026-06-20 19:00:00+00'),
    ('F','TUN','JPN','2026-06-21 06:00:00+00'),
    ('F','JPN','SWE','2026-06-26 01:00:00+00'),
    ('F','TUN','NED','2026-06-26 01:00:00+00'),
    -- ── GRUPO G ──────────────────────────────────────────────
    ('G','BEL','EGY','2026-06-15 21:00:00+00'),
    ('G','IRN','NZL','2026-06-16 03:00:00+00'),
    ('G','BEL','IRN','2026-06-21 21:00:00+00'),
    ('G','NZL','EGY','2026-06-22 03:00:00+00'),
    ('G','NZL','BEL','2026-06-27 05:00:00+00'),
    ('G','EGY','IRN','2026-06-27 05:00:00+00'),
    -- ── GRUPO H ──────────────────────────────────────────────
    ('H','ESP','CPV','2026-06-15 18:00:00+00'),
    ('H','KSA','URU','2026-06-16 00:00:00+00'),
    ('H','ESP','KSA','2026-06-21 18:00:00+00'),
    ('H','URU','CPV','2026-06-22 00:00:00+00'),
    ('H','URU','ESP','2026-06-27 02:00:00+00'),
    ('H','CPV','KSA','2026-06-27 02:00:00+00'),
    -- ── GRUPO I ──────────────────────────────────────────────
    ('I','FRA','SEN','2026-06-16 21:00:00+00'),
    ('I','NOR','IRQ','2026-06-16 00:00:00+00'),
    ('I','NOR','SEN','2026-06-22 04:00:00+00'),
    ('I','FRA','IRQ','2026-06-22 01:00:00+00'),
    ('I','NOR','FRA','2026-06-26 21:00:00+00'),
    ('I','SEN','IRQ','2026-06-26 21:00:00+00'),
    -- ── GRUPO J ──────────────────────────────────────────────
    ('J','ARG','ALG','2026-06-17 03:00:00+00'),
    ('J','AUT','JOR','2026-06-16 06:00:00+00'),
    ('J','JOR','ALG','2026-06-23 05:00:00+00'),
    ('J','ARG','AUT','2026-06-22 19:00:00+00'),
    ('J','ALG','AUT','2026-06-28 04:00:00+00'),
    ('J','JOR','ARG','2026-06-28 04:00:00+00'),
    -- ── GRUPO K ──────────────────────────────────────────────
    ('K','POR','COD','2026-06-17 19:00:00+00'),
    ('K','UZB','COL','2026-06-18 04:00:00+00'),
    ('K','POR','UZB','2026-06-23 19:00:00+00'),
    ('K','COL','COD','2026-06-24 04:00:00+00'),
    ('K','COL','POR','2026-06-28 01:30:00+00'),
    ('K','COD','UZB','2026-06-28 01:30:00+00'),
    -- ── GRUPO L ──────────────────────────────────────────────
    ('L','ENG','CRO','2026-06-17 22:00:00+00'),
    ('L','GHA','PAN','2026-06-18 01:00:00+00'),
    ('L','ENG','GHA','2026-06-23 22:00:00+00'),
    ('L','PAN','CRO','2026-06-24 01:00:00+00'),
    ('L','CRO','GHA','2026-06-27 23:00:00+00'),
    ('L','PAN','ENG','2026-06-27 23:00:00+00')

  ) AS t(grp, home_code, away_code, new_dt)
  LOOP
    SELECT id INTO v_home_id  FROM public.teams WHERE code = r.home_code;
    SELECT id INTO v_away_id  FROM public.teams WHERE code = r.away_code;
    SELECT id INTO v_group_id FROM public.groups WHERE letter = r.grp;

    IF v_home_id IS NULL THEN
      RAISE WARNING 'Team not found: %', r.home_code;
      CONTINUE;
    END IF;
    IF v_away_id IS NULL THEN
      RAISE WARNING 'Team not found: %', r.away_code;
      CONTINUE;
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
