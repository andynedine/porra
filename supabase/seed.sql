-- =============================================================
-- PORRA MUNDIAL 2026 — Seed Data
-- Run AFTER schema.sql, rls.sql, functions.sql
-- Teams, Groups, Matches, Deadlines, Achievements
-- NOTE: Groups reflect plausible 2026 draw — update as needed
-- =============================================================

-- =============================================================
-- GROUPS A–L
-- =============================================================
INSERT INTO public.groups (letter) VALUES
  ('A'), ('B'), ('C'), ('D'), ('E'), ('F'),
  ('G'), ('H'), ('I'), ('J'), ('K'), ('L');

-- =============================================================
-- 48 TEAMS (code, name, flag emoji)
-- =============================================================
INSERT INTO public.teams (code, name, flag) VALUES
-- Group A
  ('MEX', 'México',                '🇲🇽'),
  ('RSA', 'Sudáfrica',             '🇿🇦'),
  ('KOR', 'Corea del Sur',         '🇰🇷'),
  ('CZE', 'República Checa',       '🇨🇿'),
-- Group B
  ('CAN', 'Canadá',                '🇨🇦'),
  ('BIH', 'Bosnia y Herzegovina',  '🇧🇦'),
  ('QAT', 'Qatar',                 '🇶🇦'),
  ('SUI', 'Suiza',                 '🇨🇭'),
-- Group C
  ('BRA', 'Brasil',                '🇧🇷'),
  ('MAR', 'Marruecos',             '🇲🇦'),
  ('HAI', 'Haití',                 '🇭🇹'),
  ('SCO', 'Escocia',               '🏴󠁧󠁢󠁳󠁣󠁴󠁿'),
-- Group D
  ('USA', 'Estados Unidos',        '🇺🇸'),
  ('PAR', 'Paraguay',              '🇵🇾'),
  ('AUS', 'Australia',             '🇦🇺'),
  ('TUR', 'Turquía',               '🇹🇷'),
-- Group E
  ('GER', 'Alemania',              '🇩🇪'),
  ('CUW', 'Curazao',               '🇨🇼'),
  ('CIV', 'Costa de Marfil',       '🇨🇮'),
  ('ECU', 'Ecuador',               '🇪🇨'),
-- Group F
  ('NED', 'Países Bajos',          '🇳🇱'),
  ('JPN', 'Japón',                 '🇯🇵'),
  ('SWE', 'Suecia',                '🇸🇪'),
  ('TUN', 'Túnez',                 '🇹🇳'),
-- Group G
  ('BEL', 'Bélgica',               '🇧🇪'),
  ('EGY', 'Egipto',                '🇪🇬'),
  ('IRN', 'Irán',                  '🇮🇷'),
  ('NZL', 'Nueva Zelanda',         '🇳🇿'),
-- Group H
  ('ESP', 'España',                '🇪🇸'),
  ('CPV', 'Cabo Verde',            '🇨🇻'),
  ('KSA', 'Arabia Saudita',        '🇸🇦'),
  ('URU', 'Uruguay',               '🇺🇾'),
-- Group I
  ('FRA', 'Francia',               '🇫🇷'),
  ('SEN', 'Senegal',               '🇸🇳'),
  ('NOR', 'Noruega',               '🇳🇴'),
  ('IRQ', 'Irak',                  '🇮🇶'),
-- Group J
  ('ARG', 'Argentina',             '🇦🇷'),
  ('ALG', 'Argelia',               '🇩🇿'),
  ('AUT', 'Austria',               '🇦🇹'),
  ('JOR', 'Jordania',              '🇯🇴'),
-- Group K
  ('POR', 'Portugal',              '🇵🇹'),
  ('COD', 'RD Congo',              '🇨🇩'),
  ('UZB', 'Uzbekistán',            '🇺🇿'),
  ('COL', 'Colombia',              '🇨🇴'),
-- Group L
  ('ENG', 'Inglaterra',            '🏴󠁧󠁢󠁥󠁮󠁧󠁿'),
  ('CRO', 'Croacia',               '🇭🇷'),
  ('GHA', 'Ghana',                 '🇬🇭'),
  ('PAN', 'Panamá',                '🇵🇦');

-- =============================================================
-- GROUP_TEAMS assignments
-- =============================================================
DO $$
DECLARE
  grp RECORD;
  team_codes TEXT[][];
  i INTEGER;
BEGIN
  -- Map: group_letter → [code1, code2, code3, code4]
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

-- =============================================================
-- GROUP STAGE MATCHES (6 per group × 12 groups = 72 matches)
-- Pattern per group (T1=pos1, T2=pos2, T3=pos3, T4=pos4):
--   MD1: T1 vs T2,  T3 vs T4
--   MD2: T1 vs T3,  T2 vs T4
--   MD3: T1 vs T4,  T2 vs T3
-- =============================================================
DO $$
DECLARE
  v_groups TEXT[]  := ARRAY['A','B','C','D','E','F','G','H','I','J','K','L'];
  v_letter TEXT;
  v_gid    INTEGER;
  v_teams  INTEGER[];
  v_base_date TIMESTAMPTZ := '2026-06-11 18:00:00+00'::TIMESTAMPTZ;
  v_offset INTEGER := 0;

  -- matchday pairs: (t_idx1, t_idx2)
  v_pairs  INTEGER[][] := ARRAY[
    ARRAY[1,2], ARRAY[3,4],  -- MD1
    ARRAY[1,3], ARRAY[2,4],  -- MD2
    ARRAY[1,4], ARRAY[2,3]   -- MD3
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

-- =============================================================
-- KNOCKOUT STAGE PLACEHOLDER MATCHES (teams TBD by admin)
-- Octavos: 16 matches | Cuartos: 8 | Semis: 4 | Tercero: 1 | Final: 1
-- =============================================================

-- Octavos de Final (Round of 32) — July 5–11
DO $$
DECLARE
  i INTEGER;
BEGIN
  FOR i IN 1..16 LOOP
    INSERT INTO public.matches (round, match_datetime, sort_order, venue)
    VALUES (
      'octavos',
      ('2026-07-05 18:00:00+00'::TIMESTAMPTZ) + ((i-1) * INTERVAL '12 hours'),
      1000 + i,
      'Por confirmar'
    );
  END LOOP;
END;
$$;

-- Cuartos de Final (Round of 16) — July 13–16
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 1..8 LOOP
    INSERT INTO public.matches (round, match_datetime, sort_order, venue)
    VALUES ('cuartos', ('2026-07-13 18:00:00+00'::TIMESTAMPTZ) + ((i-1) * INTERVAL '18 hours'), 2000+i, 'Por confirmar');
  END LOOP;
END;
$$;

-- Semifinales — July 20–21
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 1..4 LOOP
    INSERT INTO public.matches (round, match_datetime, sort_order, venue)
    VALUES ('semis', ('2026-07-20 21:00:00+00'::TIMESTAMPTZ) + ((i-1) * INTERVAL '24 hours'), 3000+i, 'Por confirmar');
  END LOOP;
END;
$$;

-- Tercer y Cuarto Puesto — July 24
INSERT INTO public.matches (round, match_datetime, sort_order, venue)
VALUES ('tercero', '2026-07-24 18:00:00+00', 4001, 'Por confirmar');

-- La Gran Final — July 25
INSERT INTO public.matches (round, match_datetime, sort_order, venue)
VALUES ('final', '2026-07-25 21:00:00+00', 5001, 'Por confirmar');

-- =============================================================
-- DEADLINES (configurable — modify as needed)
-- =============================================================
-- 'tournament' deadline: before the tournament starts (for champion/top scorer predictions)
-- Each round deadline: before the first match of that round
INSERT INTO public.deadlines (round, deadline_at) VALUES
  ('tournament', '2026-06-10 23:59:00+00'),
  ('group',      '2026-06-11 17:30:00+00'),
  ('octavos',    '2026-07-04 23:59:00+00'),
  ('cuartos',    '2026-07-12 23:59:00+00'),
  ('semis',      '2026-07-19 23:59:00+00'),
  ('tercero',    '2026-07-23 23:59:00+00'),
  ('final',      '2026-07-24 23:59:00+00');

-- =============================================================
-- ACHIEVEMENTS
-- =============================================================
INSERT INTO public.achievements (code, name, description, badge_type, icon, threshold) VALUES
  ('FIRST_PRED',   'Primera Predicción',    'Hiciste tu primera predicción',         'SPECIAL', '⭐', NULL),
  ('BRONZE_5',     'Bronce',                '5 predicciones exactas',                'BRONZE',  '🥉',  5),
  ('SILVER_10',    'Plata',                 '10 predicciones exactas',               'SILVER',  '🥈', 10),
  ('GOLD_15',      'Oro',                   '15 predicciones exactas',               'GOLD',    '🥇', 15),
  ('PLATINUM_20',  'Platino',               '20 predicciones exactas',               'PLATINUM','💎', 20),
  ('DIAMOND_25',   'Diamante',              '25 predicciones exactas',               'PLATINUM','💠', 25),
  ('LEGEND_30',    'Leyenda',               '30 predicciones exactas',               'GOLD',    '🏆', 30),
  ('MASTER_40',    'Maestro',               '40 predicciones exactas',               'PLATINUM','🎯', 40),
  ('PROPHET_50',   'Profeta',               '50 predicciones exactas',               'SPECIAL', '🔮', 50);

-- =============================================================
-- STANDINGS INIT (one row per team per group — all zeros)
-- =============================================================
INSERT INTO public.standings (group_id, team_id)
SELECT gt.group_id, gt.team_id
FROM public.group_teams gt
ON CONFLICT (group_id, team_id) DO NOTHING;
