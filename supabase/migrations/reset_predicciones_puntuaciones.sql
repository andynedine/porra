-- ============================================================
-- RESET COMPLETO DE PREDICCIONES Y PUNTUACIONES
-- Borra predicciones de partidos, posiciones de grupo,
-- predicciones de torneo, puntuaciones, logros y clasificación.
-- NO borra usuarios ni partidos ni resultados de partidos.
-- ============================================================

-- 1) Puntos calculados en predicciones de partidos (resetear a 0)
UPDATE public.predictions
SET points = 0, is_exact = FALSE, is_partial = FALSE, calculated_at = NULL;

-- 2) Predicciones de posición de grupos (resetear puntos)
UPDATE public.group_position_predictions
SET points = 0, calculated_at = NULL;

-- 3) Predicciones de torneo (resetear puntos)
UPDATE public.tournament_predictions
SET champion_points    = 0,
    runner_up_points   = 0,
    finalist_1_points  = 0,
    finalist_2_points  = 0,
    top_scorer_points  = 0,
    calculated_at      = NULL;

-- 4) Tabla de puntuaciones agregadas por usuario
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

-- 5) Logros desbloqueados por puntuación (excepto FIRST_PRED si quieres conservarlo)
DELETE FROM public.user_achievements;
-- Si prefieres conservar FIRST_PRED descomenta la siguiente línea y comenta la de arriba:
-- DELETE FROM public.user_achievements WHERE achievement_id != (SELECT id FROM public.achievements WHERE code = 'FIRST_PRED');