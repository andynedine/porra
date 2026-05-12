-- Corregir: resetear estado de partidos de fase de grupos a 'upcoming'
UPDATE public.matches
SET status = 'upcoming', updated_at = NOW()
WHERE round = 'group';

-- Resetear clasificaciones de grupos (standings)
UPDATE public.standings
SET played = 0, won = 0, drawn = 0, lost = 0,
    goals_for = 0, goals_against = 0, points = 0,
    updated_at = NOW();