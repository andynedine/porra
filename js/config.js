// =============================================================
// config.js — Supabase client initialization
// IMPORTANT: Replace placeholder values with your project credentials
// from https://supabase.com/dashboard → Settings → API
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ⚠️ Replace these with your actual Supabase project values
const SUPABASE_URL     = 'https://uznronvyejowbexpaety.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV6bnJvbnZ5ZWpvd2JleHBhZXR5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMjMxNzcsImV4cCI6MjA5MjU5OTE3N30.uwOioNacmm2dO42lJZ69VQIva6awLUlUYQV17d2jO4A';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export const ROUNDS = {
  group:          { label: 'Fase de Grupos',      order: 1 },
  dieciseisavos:  { label: 'Dieciseisavos',       order: 2 },
  octavos:        { label: 'Octavos',             order: 3 },
  cuartos:        { label: 'Cuartos',             order: 4 },
  semis:          { label: 'Semifinales',         order: 5 },
  tercero:        { label: 'Tercer y 4º Puesto',  order: 6 },
  final:          { label: 'Gran Final',          order: 7 },
};

export const SCORING = {
  group:         { exact: 2.0,  partial: 1.0 },
  dieciseisavos: { exact: 3.0,  partial: 1.0 },
  octavos:       { exact: 4.0,  partial: 1.5 },
  cuartos:       { exact: 5.0,  partial: 2.0 },
  semis:         { exact: 6.0,  partial: 2.5 },
  tercero:       { exact: 6.0,  partial: 2.0 },
  final:         { exact: 8.0,  partial: 3.0 },
};
