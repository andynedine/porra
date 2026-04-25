// =============================================================
// config.js — Supabase client initialization
// IMPORTANT: Replace placeholder values with your project credentials
// from https://supabase.com/dashboard → Settings → API
// =============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ⚠️ Replace these with your actual Supabase project values
const SUPABASE_URL     = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

export const ROUNDS = {
  group:   { label: 'Fase de Grupos',    order: 1 },
  octavos: { label: 'Octavos de Final',  order: 2 },
  cuartos: { label: 'Cuartos de Final',  order: 3 },
  semis:   { label: 'Semifinales',       order: 4 },
  tercero: { label: 'Tercer y 4º Puesto',order: 5 },
  final:   { label: 'Gran Final',        order: 6 },
};

export const SCORING = {
  group:   { exact: 2.0,  partial: 1.0 },
  octavos: { exact: 2.5,  partial: 1.5 },
  cuartos: { exact: 3.0,  partial: 1.5 },
  semis:   { exact: 3.0,  partial: 1.5 },
  tercero: { exact: 4.0,  partial: 2.0 },
  final:   { exact: 4.0,  partial: 2.0 },
};
