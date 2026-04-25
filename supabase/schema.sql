-- =============================================================
-- PORRA MUNDIAL 2026 — Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
-- =============================================================

-- Enable UUID extension (already enabled by default in Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================
-- PROFILES (extends auth.users)
-- Auto-created via trigger on user signup
-- =============================================================
CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    TEXT        UNIQUE NOT NULL,
  email       TEXT        NOT NULL,
  phone       TEXT,
  role        TEXT        NOT NULL DEFAULT 'USER' CHECK (role IN ('USER', 'SUPERADMIN')),
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
COMMENT ON TABLE public.profiles IS 'Extended user info linked to auth.users';

-- =============================================================
-- TEAMS
-- =============================================================
CREATE TABLE public.teams (
  id           SERIAL      PRIMARY KEY,
  name         TEXT        NOT NULL,
  code         TEXT        UNIQUE NOT NULL,  -- ISO 3-letter code e.g. ESP
  flag         TEXT        DEFAULT '🏳️',    -- emoji flag
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- GROUPS (A–L for 2026)
-- =============================================================
CREATE TABLE public.groups (
  id         SERIAL      PRIMARY KEY,
  letter     CHAR(1)     NOT NULL UNIQUE,   -- 'A' to 'L'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- GROUP <-> TEAMS (M:M)
-- =============================================================
CREATE TABLE public.group_teams (
  id        SERIAL  PRIMARY KEY,
  group_id  INTEGER NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  team_id   INTEGER NOT NULL REFERENCES public.teams(id)  ON DELETE CASCADE,
  UNIQUE (group_id, team_id)
);

-- =============================================================
-- MATCHES
-- round ∈ {group, octavos, cuartos, semis, tercero, final}
-- =============================================================
CREATE TABLE public.matches (
  id              SERIAL      PRIMARY KEY,
  round           TEXT        NOT NULL CHECK (round IN ('group','octavos','cuartos','semis','tercero','final')),
  group_id        INTEGER     REFERENCES public.groups(id),
  home_team_id    INTEGER     REFERENCES public.teams(id),
  away_team_id    INTEGER     REFERENCES public.teams(id),
  match_datetime  TIMESTAMPTZ,
  venue           TEXT,
  matchday        SMALLINT    CHECK (matchday BETWEEN 1 AND 3),  -- only group stage
  status          TEXT        NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','live','finished')),
  sort_order      INTEGER     DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT chk_group_match CHECK (
    (round = 'group' AND group_id IS NOT NULL) OR
    (round <> 'group' AND group_id IS NULL)
  ),
  CONSTRAINT chk_no_self_match CHECK (home_team_id <> away_team_id)
);

-- =============================================================
-- MATCH RESULTS (entered by SUPERADMIN only)
-- =============================================================
CREATE TABLE public.match_results (
  id              SERIAL      PRIMARY KEY,
  match_id        INTEGER     NOT NULL UNIQUE REFERENCES public.matches(id) ON DELETE CASCADE,
  home_score      INTEGER     NOT NULL CHECK (home_score >= 0),
  away_score      INTEGER     NOT NULL CHECK (away_score >= 0),
  extra_time      BOOLEAN     DEFAULT FALSE,
  penalties       BOOLEAN     DEFAULT FALSE,
  home_pen_score  INTEGER,
  away_pen_score  INTEGER,
  entered_by      UUID        REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- DEADLINES (configurable per round)
-- =============================================================
CREATE TABLE public.deadlines (
  id          SERIAL      PRIMARY KEY,
  round       TEXT        NOT NULL UNIQUE CHECK (round IN ('group','octavos','cuartos','semis','tercero','final','tournament')),
  deadline_at TIMESTAMPTZ NOT NULL,
  created_by  UUID        REFERENCES public.profiles(id),
  updated_by  UUID        REFERENCES public.profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- PREDICTIONS (user match predictions)
-- home_score / away_score = -1 means not predicted → 0 pts
-- =============================================================
CREATE TABLE public.predictions (
  id             SERIAL      PRIMARY KEY,
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id       INTEGER     NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  home_score     INTEGER     NOT NULL DEFAULT -1 CHECK (home_score >= -1),
  away_score     INTEGER     NOT NULL DEFAULT -1 CHECK (away_score >= -1),
  points         DECIMAL(5,2) DEFAULT 0,
  is_exact       BOOLEAN     DEFAULT FALSE,
  is_partial     BOOLEAN     DEFAULT FALSE,
  calculated_at  TIMESTAMPTZ,
  version        INTEGER     DEFAULT 1,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, match_id)
);

-- =============================================================
-- GROUP POSITION PREDICTIONS
-- Users predict final standings order for each group
-- =============================================================
CREATE TABLE public.group_position_predictions (
  id               SERIAL      PRIMARY KEY,
  user_id          UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id         INTEGER     NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  pos_1_team_id    INTEGER     REFERENCES public.teams(id),
  pos_2_team_id    INTEGER     REFERENCES public.teams(id),
  pos_3_team_id    INTEGER     REFERENCES public.teams(id),
  pos_4_team_id    INTEGER     REFERENCES public.teams(id),
  points           DECIMAL(5,2) DEFAULT 0,
  calculated_at    TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, group_id)
);

-- =============================================================
-- TOURNAMENT PREDICTIONS (champion, runner-up, top scorer)
-- Deadline controlled by 'tournament' row in deadlines
-- =============================================================
CREATE TABLE public.tournament_predictions (
  id                   SERIAL      PRIMARY KEY,
  user_id              UUID        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  champion_team_id     INTEGER     REFERENCES public.teams(id),
  runner_up_team_id    INTEGER     REFERENCES public.teams(id),
  top_scorer_name      TEXT,
  top_scorer_team_id   INTEGER     REFERENCES public.teams(id),
  champion_points      DECIMAL(5,2) DEFAULT 0,
  runner_up_points     DECIMAL(5,2) DEFAULT 0,
  finalist_1_points    DECIMAL(5,2) DEFAULT 0,
  finalist_2_points    DECIMAL(5,2) DEFAULT 0,
  top_scorer_points    DECIMAL(5,2) DEFAULT 0,
  calculated_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- TOURNAMENT RESULTS (official, entered by SUPERADMIN)
-- =============================================================
CREATE TABLE public.tournament_results (
  id                   SERIAL      PRIMARY KEY,
  champion_team_id     INTEGER     REFERENCES public.teams(id),
  runner_up_team_id    INTEGER     REFERENCES public.teams(id),
  third_place_team_id  INTEGER     REFERENCES public.teams(id),
  top_scorer_name      TEXT,
  top_scorer_team_id   INTEGER     REFERENCES public.teams(id),
  top_scorer_goals     INTEGER,
  entered_by           UUID        REFERENCES public.profiles(id),
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- SCORES (aggregated per user — updated by triggers)
-- =============================================================
CREATE TABLE public.scores (
  id                      SERIAL      PRIMARY KEY,
  user_id                 UUID        NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  total_points            DECIMAL(8,2) DEFAULT 0,
  match_points            DECIMAL(8,2) DEFAULT 0,
  group_position_points   DECIMAL(8,2) DEFAULT 0,
  tournament_points       DECIMAL(8,2) DEFAULT 0,
  exact_count             INTEGER     DEFAULT 0,
  partial_count           INTEGER     DEFAULT 0,
  wrong_count             INTEGER     DEFAULT 0,
  total_predicted         INTEGER     DEFAULT 0,
  accuracy_pct            DECIMAL(5,2) DEFAULT 0,
  updated_at              TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- GROUP STANDINGS (updated by trigger on match_results)
-- =============================================================
CREATE TABLE public.standings (
  id             SERIAL  PRIMARY KEY,
  group_id       INTEGER NOT NULL REFERENCES public.groups(id),
  team_id        INTEGER NOT NULL REFERENCES public.teams(id),
  played         INTEGER DEFAULT 0,
  won            INTEGER DEFAULT 0,
  drawn          INTEGER DEFAULT 0,
  lost           INTEGER DEFAULT 0,
  goals_for      INTEGER DEFAULT 0,
  goals_against  INTEGER DEFAULT 0,
  goal_diff      INTEGER GENERATED ALWAYS AS (goals_for - goals_against) STORED,
  points         INTEGER DEFAULT 0,
  updated_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, team_id)
);

-- =============================================================
-- CHANGE LOGS (audit trail — only SUPERADMIN can read)
-- =============================================================
CREATE TABLE public.change_logs (
  id           SERIAL      PRIMARY KEY,
  changed_by   UUID        REFERENCES public.profiles(id),
  table_name   TEXT        NOT NULL,
  record_id    TEXT        NOT NULL,
  action       TEXT        NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data     JSONB,
  new_data     JSONB,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- ACHIEVEMENTS (definitions)
-- =============================================================
CREATE TABLE public.achievements (
  id          SERIAL  PRIMARY KEY,
  code        TEXT    UNIQUE NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  badge_type  TEXT    NOT NULL CHECK (badge_type IN ('BRONZE','SILVER','GOLD','PLATINUM','SPECIAL')),
  icon        TEXT    DEFAULT '🏅',
  threshold   INTEGER,   -- exact_count needed to unlock
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- USER ACHIEVEMENTS (earned badges)
-- =============================================================
CREATE TABLE public.user_achievements (
  id             SERIAL  PRIMARY KEY,
  user_id        UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  achievement_id INTEGER NOT NULL REFERENCES public.achievements(id),
  earned_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, achievement_id)
);

-- =============================================================
-- INDEXES
-- =============================================================
CREATE INDEX idx_matches_round    ON public.matches(round);
CREATE INDEX idx_matches_status   ON public.matches(status);
CREATE INDEX idx_matches_group    ON public.matches(group_id);
CREATE INDEX idx_pred_user        ON public.predictions(user_id);
CREATE INDEX idx_pred_match       ON public.predictions(match_id);
CREATE INDEX idx_pred_calculated  ON public.predictions(calculated_at) WHERE calculated_at IS NOT NULL;
CREATE INDEX idx_scores_points    ON public.scores(total_points DESC);
CREATE INDEX idx_change_logs_time ON public.change_logs(created_at DESC);
CREATE INDEX idx_standings_group  ON public.standings(group_id, points DESC, goal_diff DESC);
CREATE INDEX idx_grp_pos_user     ON public.group_position_predictions(user_id);
