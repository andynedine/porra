-- ============================================================
-- RESET COMPLETO PARA PRUEBAS
-- Borra TODAS las predicciones de usuarios, resultados de
-- partidos, clasificaciones, puntuaciones y logros.
-- Los usuarios, partidos, equipos y plazos se conservan.
-- ============================================================

-- 1) Borrar resultados oficiales de partidos (todas las fases)
DELETE FROM public.match_results;

-- 2) Resetear estado de todos los partidos a 'upcoming'
UPDATE public.matches
SET status = 'upcoming', updated_at = NOW();

-- 3) Resetear clasificaciones de grupos
UPDATE public.standings
SET played = 0, won = 0, drawn = 0, lost = 0,
    goals_for = 0, goals_against = 0, points = 0,
    updated_at = NOW();

-- 4) Borrar resultado oficial del torneo (campeón, pichichi, etc.)
DELETE FROM public.tournament_results;

-- 5) Borrar clasificaciones oficiales de grupos (introducidas por superadmin)
DELETE FROM public.group_position_results;

-- 6) Borrar predicciones de partidos de todos los usuarios
DELETE FROM public.predictions;

-- 7) Borrar predicciones de posición de grupos de todos los usuarios
DELETE FROM public.group_position_predictions;

-- 8) Borrar predicciones de torneo (campeón, finalistas, pichichi)
DELETE FROM public.tournament_predictions;

-- 9) Resetear puntuaciones agregadas de todos los usuarios
UPDATE public.scores
SET total_points          = 0,
    match_points          = 0,
    group_position_points = 0,
    tournament_points     = 0,
    exact_count           = 0,
    partial_count         = 0,
    wrong_count           = 0,
    total_predicted       = 0,
    accuracy_pct          = 0,
    updated_at            = NOW();

-- 10) Borrar logros desbloqueados
DELETE FROM public.user_achievements;