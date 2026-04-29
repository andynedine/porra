-- =============================================================
-- ADD DIECISEISAVOS DE FINAL
--
-- World Cup 2026 has 48 teams → 12 groups → 32 teams advance.
-- This creates a Round of 32 (Dieciseisavos) between group stage
-- and the Round of 16 (Octavos).
--
-- Changes:
--  1) Extend CHECK constraints to accept 'dieciseisavos'
--  2) Delete old placeholder knockout matches (wrong schedule)
--  3) Insert all 32 knockout matches with correct dates/venues
--  4) Add deadline for dieciseisavos
-- =============================================================

-- 1) Extend round CHECK on matches
ALTER TABLE public.matches
  DROP CONSTRAINT IF EXISTS matches_round_check;
ALTER TABLE public.matches
  ADD CONSTRAINT matches_round_check
  CHECK (round IN ('group','dieciseisavos','octavos','cuartos','semis','tercero','final'));

-- 1b) Extend round CHECK on deadlines
ALTER TABLE public.deadlines
  DROP CONSTRAINT IF EXISTS deadlines_round_check;
ALTER TABLE public.deadlines
  ADD CONSTRAINT deadlines_round_check
  CHECK (round IN ('group','dieciseisavos','octavos','cuartos','semis','tercero','final','tournament'));

-- 2) Remove all old placeholder knockout matches
DELETE FROM public.matches
WHERE round IN ('octavos','cuartos','semis','tercero','final');

-- =============================================================
-- 3) DIECISEISAVOS DE FINAL — matches 73-88
--    Teams TBD by admin, venues and dates are confirmed.
--    Times in UTC (approximate, to be adjusted when confirmed).
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Domingo 28 de junio
  ('dieciseisavos', '2026-06-28 22:00:00+00', 'SoFi Stadium (Los Angeles)',                     1001),
  -- Lunes 29 de junio
  ('dieciseisavos', '2026-06-29 18:00:00+00', 'Gillette Stadium (Boston)',                      1002),
  ('dieciseisavos', '2026-06-29 21:00:00+00', 'Estadio BBVA (Monterrey)',                       1003),
  ('dieciseisavos', '2026-06-29 23:00:00+00', 'NRG Stadium (Houston)',                          1004),
  -- Martes 30 de junio
  ('dieciseisavos', '2026-06-30 18:00:00+00', 'MetLife Stadium (Nueva York-Nueva Jersey)',       1005),
  ('dieciseisavos', '2026-06-30 21:00:00+00', 'AT&T Stadium (Dallas)',                          1006),
  ('dieciseisavos', '2026-06-30 23:00:00+00', 'Estadio Azteca (Ciudad de México)',               1007),
  -- Miércoles 1 de julio
  ('dieciseisavos', '2026-07-01 18:00:00+00', 'Mercedes-Benz Stadium (Atlanta)',                 1008),
  ('dieciseisavos', '2026-07-01 21:00:00+00', 'Levi''s Stadium (San Francisco)',                 1009),
  ('dieciseisavos', '2026-07-01 23:00:00+00', 'Lumen Field (Seattle)',                          1010),
  -- Jueves 2 de julio
  ('dieciseisavos', '2026-07-02 18:00:00+00', 'BMO Field (Toronto)',                            1011),
  ('dieciseisavos', '2026-07-02 22:00:00+00', 'SoFi Stadium (Los Angeles)',                     1012),
  ('dieciseisavos', '2026-07-02 23:30:00+00', 'BC Place (Vancouver)',                           1013),
  -- Viernes 3 de julio
  ('dieciseisavos', '2026-07-03 18:00:00+00', 'Hard Rock Stadium (Miami)',                      1014),
  ('dieciseisavos', '2026-07-03 21:00:00+00', 'Arrowhead Stadium (Kansas City)',                1015),
  ('dieciseisavos', '2026-07-03 23:00:00+00', 'AT&T Stadium (Dallas)',                          1016);

-- =============================================================
-- OCTAVOS DE FINAL — matches 89-96
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Sábado 4 de julio
  ('octavos', '2026-07-04 18:00:00+00', 'Lincoln Financial Field (Philadelphia)',               2001),
  ('octavos', '2026-07-04 22:00:00+00', 'NRG Stadium (Houston)',                               2002),
  -- Domingo 5 de julio
  ('octavos', '2026-07-05 18:00:00+00', 'MetLife Stadium (Nueva York-Nueva Jersey)',            2003),
  ('octavos', '2026-07-05 22:00:00+00', 'Estadio Azteca (Ciudad de México)',                    2004),
  -- Lunes 6 de julio
  ('octavos', '2026-07-06 18:00:00+00', 'AT&T Stadium (Dallas)',                               2005),
  ('octavos', '2026-07-06 22:00:00+00', 'Lumen Field (Seattle)',                               2006),
  -- Martes 7 de julio
  ('octavos', '2026-07-07 18:00:00+00', 'Mercedes-Benz Stadium (Atlanta)',                      2007),
  ('octavos', '2026-07-07 22:00:00+00', 'BC Place (Vancouver)',                                2008);

-- =============================================================
-- CUARTOS DE FINAL — matches 97-100
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Jueves 9 de julio
  ('cuartos', '2026-07-09 21:00:00+00', 'Gillette Stadium (Boston)',                           3001),
  -- Viernes 10 de julio
  ('cuartos', '2026-07-10 21:00:00+00', 'SoFi Stadium (Los Angeles)',                          3002),
  -- Sábado 11 de julio
  ('cuartos', '2026-07-11 18:00:00+00', 'Hard Rock Stadium (Miami)',                           3003),
  ('cuartos', '2026-07-11 22:00:00+00', 'Arrowhead Stadium (Kansas City)',                     3004);

-- =============================================================
-- SEMIFINALES — matches 101-102
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Martes 14 de julio
  ('semis', '2026-07-14 21:00:00+00', 'AT&T Stadium (Dallas)',                                 4001),
  -- Miércoles 15 de julio
  ('semis', '2026-07-15 21:00:00+00', 'Mercedes-Benz Stadium (Atlanta)',                       4002);

-- =============================================================
-- TERCER Y CUARTO PUESTO
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Sábado 18 de julio
  ('tercero', '2026-07-18 21:00:00+00', 'Hard Rock Stadium (Miami)',                           5001);

-- =============================================================
-- GRAN FINAL
-- =============================================================
INSERT INTO public.matches (round, match_datetime, venue, sort_order) VALUES
  -- Domingo 19 de julio
  ('final', '2026-07-19 21:00:00+00', 'MetLife Stadium (Nueva York-Nueva Jersey)',              6001);

-- =============================================================
-- 4) DEADLINES
-- =============================================================
INSERT INTO public.deadlines (round, deadline_at)
VALUES ('dieciseisavos', '2026-06-28 21:00:00+00')
ON CONFLICT (round) DO UPDATE SET deadline_at = EXCLUDED.deadline_at;

-- Update existing deadlines to match new schedule
INSERT INTO public.deadlines (round, deadline_at) VALUES
  ('octavos',       '2026-07-04 17:00:00+00'),
  ('cuartos',       '2026-07-09 20:00:00+00'),
  ('semis',         '2026-07-14 20:00:00+00'),
  ('tercero',       '2026-07-18 20:00:00+00'),
  ('final',         '2026-07-19 20:00:00+00')
ON CONFLICT (round) DO UPDATE SET deadline_at = EXCLUDED.deadline_at;
