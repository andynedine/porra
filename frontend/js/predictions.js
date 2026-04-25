// =============================================================
// predictions.js — Predictions UI & logic
// =============================================================
import {
  getMatches, getDeadlines, getMyPredictions,
  savePredictionsBulk, upsertGroupPositionPrediction,
  getGroupPositionPredictions, upsertTournamentPrediction,
  getTournamentPrediction, getGroups, getTeams,
} from './api.js';
import {
  formatDate, deadlinePassed, roundLabel, scoringTooltip,
  previewPoints, showToast, escapeHtml, fmtPts, resultClass, groupBy,
} from './utils.js';
import { ROUNDS } from './config.js';

let _unsavedChanges = false;
let _pendingPredictions = {}; // match_id → { home, away }
let _currentUser = null;
let _deadlines = {};

/** Initialize predictions module */
export async function initPredictions(user) {
  _currentUser = user;
  const el = document.getElementById('predictions-section');
  if (!el) return;

  el.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando predicciones…</div>';

  try {
    [_deadlines] = await Promise.all([getDeadlines()]);
    await renderPredictionsUI(el);
  } catch (err) {
    el.innerHTML = `<div class="error">Error al cargar predicciones: ${escapeHtml(err.message)}</div>`;
  }
}

async function renderPredictionsUI(container) {
  const [matches, myPreds, groups, teams] = await Promise.all([
    getMatches(),
    getMyPredictions(_currentUser.id),
    getGroups(),
    getTeams(),
  ]);

  // Index my predictions by match_id
  const predMap = {};
  for (const p of myPreds) predMap[p.match_id] = p;

  // Build round tabs
  const roundOrder = Object.keys(ROUNDS);
  const matchesByRound = groupBy(matches, 'round');

  let tabsHtml = '<div class="round-tabs" role="tablist">';
  let contentHtml = '';

  for (const round of roundOrder) {
    const roundMatches = matchesByRound[round] ?? [];
    if (roundMatches.length === 0) continue;
    const dl = _deadlines[round];
    const closed = deadlinePassed(dl?.deadline_at);
    const label = roundLabel(round);
    const badge = closed ? '🔒' : '✍️';
    tabsHtml += `
      <button class="round-tab" role="tab" data-round="${escapeHtml(round)}"
        aria-selected="false" aria-controls="round-panel-${escapeHtml(round)}">
        ${badge} ${escapeHtml(label)}
      </button>`;

    contentHtml += `<div id="round-panel-${escapeHtml(round)}" class="round-panel hidden" role="tabpanel" data-round="${escapeHtml(round)}">`;

    if (dl) {
      contentHtml += `<div class="deadline-banner ${closed ? 'deadline-banner--closed' : 'deadline-banner--open'}">
        ${closed ? '🔒 Plazo cerrado' : '⏰ Plazo: ' + formatDate(dl.deadline_at)}
      </div>`;
    }

    contentHtml += `<div class="matches-grid">`;

    for (const m of roundMatches) {
      const pred = predMap[m.id] ?? { home_score: -1, away_score: -1, points: 0, is_exact: false, is_partial: false, calculated_at: null };
      const result = m.match_results?.[0] ?? null;
      const pts = result
        ? previewPoints(m.round, pred.home_score, pred.away_score, result.home_score, result.away_score)
        : null;
      const rCls = resultClass(pred.is_exact, pred.is_partial, pred.calculated_at);

      const homeDisplay = pred.home_score >= 0 ? pred.home_score : '';
      const awayDisplay = pred.away_score >= 0 ? pred.away_score : '';

      contentHtml += `
        <div class="match-card ${rCls}" data-match-id="${m.id}">
          <div class="match-card__header">
            <span class="match-datetime">${formatDate(m.match_datetime)}</span>
            ${m.group ? `<span class="match-group">Grupo ${escapeHtml(m.group.letter)}</span>` : `<span class="match-group">${escapeHtml(roundLabel(m.round))}</span>`}
          </div>
          <div class="match-card__teams">
            <div class="team team--home">
              <span class="team__flag">${m.home_team ? escapeHtml(m.home_team.flag) : '🏳️'}</span>
              <span class="team__name">${m.home_team ? escapeHtml(m.home_team.name) : 'Por confirmar'}</span>
            </div>
            <div class="prediction-inputs ${closed ? 'prediction-inputs--locked' : ''}">
              <input type="number" class="score-input score-input--home"
                data-match="${m.id}" data-side="home"
                min="0" max="99"
                value="${escapeHtml(String(homeDisplay))}"
                ${closed ? 'disabled' : ''}
                aria-label="Goles local">
              <span class="score-sep">–</span>
              <input type="number" class="score-input score-input--away"
                data-match="${m.id}" data-side="away"
                min="0" max="99"
                value="${escapeHtml(String(awayDisplay))}"
                ${closed ? 'disabled' : ''}
                aria-label="Goles visitante">
            </div>
            <div class="team team--away">
              <span class="team__name">${m.away_team ? escapeHtml(m.away_team.name) : 'Por confirmar'}</span>
              <span class="team__flag">${m.away_team ? escapeHtml(m.away_team.flag) : '🏳️'}</span>
            </div>
          </div>
          ${result ? `
            <div class="match-card__result">
              Resultado: ${result.home_score} – ${result.away_score}
              ${result.penalties ? `(pen. ${result.home_pen_score}–${result.away_pen_score})` : ''}
            </div>` : ''}
          ${pts !== null ? `<div class="match-card__points ${pts > 0 ? 'points--positive' : 'points--zero'}">+${fmtPts(pts)} pts</div>` : ''}
          <div class="match-card__scoring-hint">${escapeHtml(scoringTooltip(m.round))}</div>
        </div>`;
    }

    contentHtml += '</div>'; // matches-grid

    // Save button for open rounds
    const closed2 = deadlinePassed(_deadlines[round]?.deadline_at);
    if (!closed2) {
      contentHtml += `
        <div class="save-bar">
          <button class="btn btn--primary save-round-btn" data-round="${escapeHtml(round)}" id="save-btn-${escapeHtml(round)}">
            💾 Guardar predicciones
          </button>
          <span class="unsaved-indicator hidden" id="unsaved-${escapeHtml(round)}">⚠️ Hay cambios sin guardar</span>
        </div>`;
    }

    contentHtml += '</div>'; // round-panel
  }

  tabsHtml += '</div>';

  // Tournament predictions section
  const tournamentHtml = await buildTournamentPredSection(teams);

  container.innerHTML = tabsHtml + contentHtml + tournamentHtml;

  // Activate first tab
  const firstTab = container.querySelector('.round-tab');
  if (firstTab) activateTab(firstTab);

  // Event: tab clicks
  container.querySelectorAll('.round-tab').forEach(tab => {
    tab.addEventListener('click', () => activateTab(tab));
  });

  // Event: score input changes
  container.querySelectorAll('.score-input').forEach(input => {
    input.addEventListener('input', onScoreInput);
  });

  // Event: save buttons
  container.querySelectorAll('.save-round-btn').forEach(btn => {
    btn.addEventListener('click', () => saveRound(btn.dataset.round, predMap, matches));
  });

  // Tournament form
  bindTournamentForm(container);

  // Warn before navigating away with unsaved changes
  window.addEventListener('beforeunload', e => {
    if (_unsavedChanges) e.preventDefault();
  });
}

function activateTab(selectedTab) {
  const container = selectedTab.closest('[id]')?.parentElement ?? document;
  container.querySelectorAll('.round-tab').forEach(t => {
    t.setAttribute('aria-selected', 'false');
    t.classList.remove('active');
  });
  container.querySelectorAll('.round-panel').forEach(p => p.classList.add('hidden'));
  selectedTab.setAttribute('aria-selected', 'true');
  selectedTab.classList.add('active');
  const panel = document.getElementById(`round-panel-${selectedTab.dataset.round}`);
  if (panel) panel.classList.remove('hidden');
}

function onScoreInput(e) {
  const input = e.target;
  const matchId = parseInt(input.dataset.match, 10);
  const side = input.dataset.side;
  const val = parseInt(input.value, 10);

  if (!_pendingPredictions[matchId]) _pendingPredictions[matchId] = {};
  _pendingPredictions[matchId][side] = val;
  _unsavedChanges = true;

  // Show unsaved indicator
  const round = input.closest('.round-panel')?.dataset.round;
  if (round) {
    const indicator = document.getElementById(`unsaved-${round}`);
    if (indicator) indicator.classList.remove('hidden');
  }
}

async function saveRound(round, predMap, matches) {
  const btn = document.getElementById(`save-btn-${round}`);
  const roundMatches = matches.filter(m => m.round === round);
  const toSave = [];

  for (const m of roundMatches) {
    const pending = _pendingPredictions[m.id];
    const existing = predMap[m.id];

    let homeScore = pending?.home ?? existing?.home_score ?? -1;
    let awayScore = pending?.away ?? existing?.away_score ?? -1;

    // Only save if both sides are filled
    if (pending?.home !== undefined || pending?.away !== undefined) {
      if (homeScore < 0 || awayScore < 0) continue; // skip incomplete
      toSave.push({ match_id: m.id, home_score: homeScore, away_score: awayScore });
    }
  }

  if (toSave.length === 0) {
    showToast('No hay cambios nuevos para guardar', 'info');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  try {
    await savePredictionsBulk(_currentUser.id, toSave);
    // Update predMap
    for (const p of toSave) predMap[p.match_id] = { ...predMap[p.match_id], ...p };
    // Clear pending for this round
    for (const m of roundMatches) delete _pendingPredictions[m.id];
    _unsavedChanges = Object.keys(_pendingPredictions).length > 0;

    const indicator = document.getElementById(`unsaved-${round}`);
    if (indicator) indicator.classList.add('hidden');

    showToast(`✅ ${toSave.length} predicciones guardadas`, 'success');
  } catch (err) {
    showToast(`Error al guardar: ${err.message}`, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '💾 Guardar predicciones'; }
  }
}

// --- Tournament Predictions ---------------------------------
async function buildTournamentPredSection(teams) {
  const dl = _deadlines['tournament'];
  const closed = deadlinePassed(dl?.deadline_at);
  const existing = await getTournamentPrediction(_currentUser.id).catch(() => null);

  const teamOptions = teams
    .map(t => `<option value="${t.id}" ${existing?.champion_team_id === t.id ? 'selected' : ''}>${escapeHtml(t.flag)} ${escapeHtml(t.name)}</option>`)
    .join('');

  const runnerUpOptions = teams
    .map(t => `<option value="${t.id}" ${existing?.runner_up_team_id === t.id ? 'selected' : ''}>${escapeHtml(t.flag)} ${escapeHtml(t.name)}</option>`)
    .join('');

  return `
    <section class="tournament-preds" id="tournament-preds">
      <h2 class="section-title">🏆 Predicciones del Torneo</h2>
      ${dl ? `<div class="deadline-banner ${closed ? 'deadline-banner--closed' : 'deadline-banner--open'}">
        ${closed ? '🔒 Plazo cerrado' : '⏰ Plazo: ' + formatDate(dl.deadline_at)}
      </div>` : ''}
      <form id="tournament-form" class="tournament-form ${closed ? 'form--locked' : ''}">
        <div class="form-group">
          <label>🥇 Campeón (+10 pts)</label>
          <select name="champion_team_id" ${closed ? 'disabled' : ''} required>
            <option value="">— Seleccionar —</option>
            ${teamOptions}
          </select>
        </div>
        <div class="form-group">
          <label>🥈 Subcampeón (+3 pts finalista)</label>
          <select name="runner_up_team_id" ${closed ? 'disabled' : ''} required>
            <option value="">— Seleccionar —</option>
            ${runnerUpOptions}
          </select>
        </div>
        <div class="form-group">
          <label>⚽ Máximo Goleador (+10 pts)</label>
          <input type="text" name="top_scorer_name" 
            value="${escapeHtml(existing?.top_scorer_name ?? '')}"
            placeholder="Nombre del jugador" 
            maxlength="100"
            ${closed ? 'disabled' : ''}>
        </div>
        ${!closed ? `<button type="submit" class="btn btn--gold">💾 Guardar predicciones del torneo</button>` : ''}
      </form>
    </section>`;
}

function bindTournamentForm(container) {
  const form = container.querySelector('#tournament-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    const fd = new FormData(form);
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
    try {
      await upsertTournamentPrediction(_currentUser.id, {
        champion_team_id:  parseInt(fd.get('champion_team_id')) || null,
        runner_up_team_id: parseInt(fd.get('runner_up_team_id')) || null,
        top_scorer_name:   fd.get('top_scorer_name'),
      });
      showToast('✅ Predicciones del torneo guardadas', 'success');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '💾 Guardar predicciones del torneo'; }
    }
  });
}
