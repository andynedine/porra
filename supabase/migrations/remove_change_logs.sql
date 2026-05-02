-- =============================================================
-- Migration: remove_change_logs
-- Removes the change_logs table and all related triggers/functions
-- to free up database space.
-- =============================================================

-- 1. Drop triggers that write to change_logs
DROP TRIGGER IF EXISTS log_match_results_changes ON public.match_results;
DROP TRIGGER IF EXISTS log_predictions_changes   ON public.predictions;

-- 2. Drop trigger + manual log functions
DROP FUNCTION IF EXISTS public.auto_log_change() CASCADE;
DROP FUNCTION IF EXISTS public.log_change(TEXT, TEXT, TEXT, JSONB, JSONB) CASCADE;

-- 3. Drop the table itself (CASCADE removes any remaining FK references)
DROP TABLE IF EXISTS public.change_logs CASCADE;
