-- Migration: add finalist_2_team_id to tournament_predictions
-- Run this once in the Supabase SQL Editor

ALTER TABLE public.tournament_predictions
  ADD COLUMN IF NOT EXISTS finalist_2_team_id INTEGER REFERENCES public.teams(id);
