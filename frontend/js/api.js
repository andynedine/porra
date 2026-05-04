// =============================================================
// api.js — All Supabase data operations
// =============================================================
import { supabase } from './config.js';

// ---- Groups & Teams -----------------------------------------
export async function getGroups() {
  const { data, error } = await supabase
    .from('groups')
    .select('*, group_teams(team_id, teams(id, name, code, flag))')
    .order('letter');
  if (error) throw error;
  return data;
}

export async function getTeams() {
  const { data, error } = await supabase.from('teams').select('*').order('name');
  if (error) throw error;
  return data;
}

// ---- Matches ------------------------------------------------
export async function getMatches(round = null) {
  let query = supabase
    .from('matches')
    .select(`
      *,
      home_team:home_team_id(id, name, code, flag),
      away_team:away_team_id(id, name, code, flag),
      group:group_id(letter),
      match_results(home_score, away_score)
    `)
    .order('sort_order');
  if (round) query = query.eq('round', round);
  const { data, error } = await query;
  if (error) throw error;
  // Normalize match_results: PostgREST may return an object {} or array [] depending on version.
  // Normalize to a single result object or null.
  return (data ?? []).map(m => {
    let r = m.match_results;
    if (Array.isArray(r)) r = r[0] ?? null;
    // Guard against empty object with no scores
    if (r && r.home_score === undefined && r.away_score === undefined) r = null;
    return { ...m, match_results: r };
  });
}

export async function getMatch(matchId) {
  const { data, error } = await supabase
    .from('matches')
    .select(`
      *,
      home_team:home_team_id(id, name, code, flag),
      away_team:away_team_id(id, name, code, flag),
      group:group_id(letter),
      match_results(*)
    `)
    .eq('id', matchId)
    .single();
  if (error) throw error;
  return data;
}

// ---- Standings ----------------------------------------------
export async function getStandings(groupId = null) {
  let query = supabase
    .from('standings')
    .select('*, team:team_id(id, name, code, flag), group:group_id(letter)')
    .order('points', { ascending: false })
    .order('goal_diff', { ascending: false })
    .order('goals_for', { ascending: false });
  if (groupId) query = query.eq('group_id', groupId);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

// ---- Deadlines ----------------------------------------------
export async function getDeadlines() {
  const { data, error } = await supabase.from('deadlines').select('*');
  if (error) throw error;
  // Index by round for easy lookup
  return Object.fromEntries((data ?? []).map(d => [d.round, d]));
}

// ---- Predictions (user) -------------------------------------
export async function getMyPredictions(userId) {
  const { data, error } = await supabase
    .from('predictions')
    .select('*, match:match_id(id, round, group_id, home_team_id, away_team_id, match_datetime, matchday, status, match_results(home_score, away_score))')
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function getMatchPredictions(matchId) {
  const { data, error } = await supabase
    .from('predictions')
    .select('*, user:user_id(username, avatar_url)')
    .eq('match_id', matchId);
  if (error) throw error;
  return data;
}

export async function upsertPrediction(userId, matchId, homeScore, awayScore) {
  const { data, error } = await supabase
    .from('predictions')
    .upsert({
      user_id:    userId,
      match_id:   matchId,
      home_score: homeScore,
      away_score: awayScore,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,match_id', ignoreDuplicates: false })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Bulk save an array of { match_id, home_score, away_score } */
export async function savePredictionsBulk(userId, predictions) {
  const rows = predictions.map(p => ({
    user_id:    userId,
    match_id:   p.match_id,
    home_score: p.home_score,
    away_score: p.away_score,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from('predictions')
    .upsert(rows, { onConflict: 'user_id,match_id', ignoreDuplicates: false });
  if (error) throw error;
}

// ---- Group Position Predictions -----------------------------
export async function getGroupPositionPredictions(userId) {
  const { data, error } = await supabase
    .from('group_position_predictions')
    .select('*')
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function upsertGroupPositionPrediction(userId, groupId, positions) {
  const { data, error } = await supabase
    .from('group_position_predictions')
    .upsert({
      user_id:        userId,
      group_id:       groupId,
      pos_1_team_id:  positions[0] ?? null,
      pos_2_team_id:  positions[1] ?? null,
      pos_3_team_id:  positions[2] ?? null,
      pos_4_team_id:  positions[3] ?? null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'user_id,group_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Group Position Results (official, entered by SUPERADMIN) --
export async function getGroupPositionResults() {
  const { data, error } = await supabase
    .from('group_position_results')
    .select('*');
  if (error) throw error;
  return data ?? [];
}

export async function upsertGroupPositionResult(groupId, positions) {
  const { data, error } = await supabase
    .from('group_position_results')
    .upsert({
      group_id:       groupId,
      pos_1_team_id:  positions[0] ?? null,
      pos_2_team_id:  positions[1] ?? null,
      pos_3_team_id:  positions[2] ?? null,
      pos_4_team_id:  positions[3] ?? null,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'group_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Tournament Predictions --------------------------------
export async function getTournamentPrediction(userId) {
  const { data, error } = await supabase
    .from('tournament_predictions')
    .select('*, champion_team:champion_team_id(name,flag), finalist_1_team:runner_up_team_id(name,flag), finalist_2_team:finalist_2_team_id(name,flag)')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertTournamentPrediction(userId, pred) {
  const { data, error } = await supabase
    .from('tournament_predictions')
    .upsert({
      user_id:              userId,
      champion_team_id:     pred.champion_team_id ?? null,
      runner_up_team_id:    pred.finalist_1_team_id ?? null,
      finalist_2_team_id:   pred.finalist_2_team_id ?? null,
      top_scorer_name:      pred.top_scorer_name?.trim() ?? null,
      top_scorer_team_id:   pred.top_scorer_team_id ?? null,
      updated_at:           new Date().toISOString(),
    }, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- Ranking -----------------------------------------------
export async function getGlobalRanking() {
  const { data, error } = await supabase
    .from('ranking')   // uses the VIEW created in functions.sql
    .select('*');
  if (error) throw error;
  return data;
}

export async function getRoundRanking(round) {
  const { data, error } = await supabase.rpc('get_round_ranking', { p_round: round });
  if (error) throw error;
  return data;
}

export async function getMyScore(userId) {
  const { data, error } = await supabase
    .from('scores')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getMyPointsBreakdown(userId) {
  const [predsRes, tournamentRes, groupPosRes] = await Promise.all([
    supabase
      .from('predictions')
      .select('points, match:match_id(round)')
      .eq('user_id', userId)
      .not('calculated_at', 'is', null),
    supabase
      .from('tournament_predictions')
      .select('champion_points, runner_up_points, finalist_1_points, finalist_2_points, top_scorer_points')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('group_position_predictions')
      .select('points, group_id, calculated_at, group:group_id(letter)')
      .eq('user_id', userId)
      .not('calculated_at', 'is', null),
  ]);
  if (predsRes.error) throw predsRes.error;
  if (tournamentRes.error) throw tournamentRes.error;
  if (groupPosRes.error) throw groupPosRes.error;

  // Sum predictions points by round
  const byRound = {};
  for (const p of predsRes.data ?? []) {
    const round = p.match?.round ?? 'unknown';
    byRound[round] = (byRound[round] ?? 0) + (p.points ?? 0);
  }

  // Per-group classification points (sorted by group letter)
  const groupPositionByGroup = (groupPosRes.data ?? [])
    .sort((a, b) => (a.group?.letter ?? '').localeCompare(b.group?.letter ?? ''))
    .map(g => ({
      group_id:     g.group_id,
      group_letter: g.group?.letter ?? '?',
      points:       g.points ?? 0,
    }));

  const groupPositionPts = groupPositionByGroup.reduce((acc, g) => acc + g.points, 0);

  return {
    byRound,
    groupPositionPts,
    groupPositionByGroup,
    tournament: tournamentRes.data ?? null,
  };
}

// ---- Achievements -------------------------------------------
export async function getMyAchievements(userId) {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('*, achievement:achievement_id(*)')
    .eq('user_id', userId)
    .order('earned_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getAllAchievements() {
  const { data, error } = await supabase
    .from('achievements')
    .select('*')
    .order('threshold', { nullsFirst: true });
  if (error) throw error;
  return data;
}

// ---- ADMIN: Match results -----------------------------------
export async function adminRecalculateAllScores() {
  const { data, error } = await supabase.rpc('admin_recalculate_all_scores');
  if (error) throw error;
  return data;
}

export async function upsertMatchResult(matchId, homeScore, awayScore) {
  const { data, error } = await supabase
    .from('match_results')
    .upsert({
      match_id:   matchId,
      home_score: homeScore,
      away_score: awayScore,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'match_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function upsertMatch(matchData) {
  const { data, error } = await supabase
    .from('matches')
    .upsert(matchData, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- ADMIN: Deadlines ---------------------------------------
export async function upsertDeadline(round, deadlineAt) {
  const { data, error } = await supabase
    .from('deadlines')
    .upsert({ round, deadline_at: deadlineAt }, { onConflict: 'round' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- ADMIN: User predictions (edit on behalf) ---------------
export async function getAllUserPredictions(matchId) {
  const { data, error } = await supabase
    .from('predictions')
    .select('*, user:user_id(username)')
    .eq('match_id', matchId)
    .order('user_id');
  if (error) throw error;
  return data;
}

export async function adminUpdatePrediction(predictionId, homeScore, awayScore) {
  const { data, error } = await supabase
    .from('predictions')
    .update({ home_score: homeScore, away_score: awayScore, updated_at: new Date().toISOString() })
    .eq('id', predictionId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ---- ADMIN: Users list -------------------------------------
export async function getAllUsers() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, email, phone, role, admitido, created_at')
    .order('username');
  if (error) throw error;
  return data;
}

export async function updateUserRole(userId, role) {
  const { error } = await supabase
    .from('profiles')
    .update({ role })
    .eq('id', userId);
  if (error) throw error;
}

export async function updateUserAdmitido(userId, admitido) {
  const { error } = await supabase
    .from('profiles')
    .update({ admitido })
    .eq('id', userId);
  if (error) throw error;
}

export async function deleteUsers(userIds) {
  const { error } = await supabase.rpc('admin_delete_users', { user_ids: userIds });
  if (error) throw error;
}

/**
 * Returns every user's tournament prediction (champion, finalists, top scorer).
 * RLS enforces this only returns data once the 'tournament' deadline has passed.
 */
export async function getAllTournamentPredictions() {
  const { data, error } = await supabase
    .from('tournament_predictions')
    .select(`
      user_id,
      champion_team_id, champion_points,
      runner_up_team_id, runner_up_points,
      finalist_2_team_id, finalist_1_points, finalist_2_points,
      top_scorer_name, top_scorer_team_id, top_scorer_points,
      calculated_at,
      user:user_id(id, username)
    `);
  if (error) throw error;
  return data ?? [];
}

// ---- Public: all users' predictions (read after deadline) --

/**
 * Returns every prediction for a given round from all users.
 * RLS enforces this only returns data once the round deadline has passed.
 */
export async function getAllPredictionsForRound(round) {
  const { data: matchData, error: matchErr } = await supabase
    .from('matches')
    .select('id')
    .eq('round', round);
  if (matchErr) throw matchErr;
  if (!matchData?.length) return [];

  const { data, error } = await supabase
    .from('predictions')
    .select('user_id, match_id, home_score, away_score, points, is_exact, is_partial, calculated_at, user:user_id(id, username)')
    .in('match_id', matchData.map(m => m.id));
  if (error) throw error;
  return data ?? [];
}

/**
 * Returns every user's group-classification predictions.
 * RLS enforces this only returns data once the 'group' deadline has passed.
 */
export async function getAllGroupPositionPredictionsAll() {
  const { data, error } = await supabase
    .from('group_position_predictions')
    .select('user_id, group_id, pos_1_team_id, pos_2_team_id, pos_3_team_id, pos_4_team_id, points, calculated_at, user:user_id(id, username)');
  if (error) throw error;
  return data ?? [];
}

// ---- ADMIN: Tournament results ------------------------------
export async function upsertTournamentResult(resultData) {
  // Always work with id=1 (singleton)
  const { data: existing } = await supabase.from('tournament_results').select('id').limit(1).maybeSingle();
  const payload = { ...resultData, updated_at: new Date().toISOString() };
  if (existing?.id) payload.id = existing.id;
  const { data, error } = await supabase
    .from('tournament_results')
    .upsert(payload)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getTournamentResult() {
  const { data, error } = await supabase
    .from('tournament_results')
    .select('*, champion:champion_team_id(name,flag), runner_up:runner_up_team_id(name,flag), third_place:third_place_team_id(name,flag)')
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Realtime subscription ---------------------------------
let _scoresChannel = null;
export function subscribeToScores(callback) {
  if (_scoresChannel) {
    supabase.removeChannel(_scoresChannel);
    _scoresChannel = null;
  }
  _scoresChannel = supabase
    .channel('scores-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, callback)
    .subscribe();
  return _scoresChannel;
}
export function unsubscribeFromScores() {
  if (_scoresChannel) {
    supabase.removeChannel(_scoresChannel);
    _scoresChannel = null;
  }
}

export function subscribeToMatchResults(callback) {
  return supabase
    .channel('results-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_results' }, callback)
    .subscribe();
}
