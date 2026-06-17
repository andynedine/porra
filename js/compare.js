// =============================================================
// compare.js — View all users' predictions after deadline
// =============================================================
import {
  getDeadlines, getMatches, getGroups, getTeams,
  getAllPredictionsForRound, getAllGroupPositionPredictionsAll,
  getGroupPositionResults, getAllTournamentPredictions, getTournamentResult,
} from './api.js';
import {
  formatDate, deadlinePassed, roundLabel, escapeHtml, flagImg, groupBy, fmtPts, previewPoints,
} from './utils.js';
import { ROUNDS } from './config.js';

let _currentUser = null;
let _deadlines   = {};

// ============================================================
// Entry point — user dashboard
// ============================================================
export async function initCompare(user) {
  _currentUser = user;
  const container = document.getElementById('panel-comparar');
  if (!container) return;
  await _renderCompare(container, /* forceAll */ false);
}

// ============================================================
// Entry point — superadmin panel (all phases always visible)
// ============================================================
export async function initAdminCompare(user) {
  _currentUser = user;
  const container = document.getElementById('admin-panel-predictions');
  if (!container) return;
  await _renderCompare(container, /* forceAll */ true);
}

// ============================================================
// Shared renderer
// ============================================================
async function _renderCompare(container, forceAll) {
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando…</div>';

  try {
    _deadlines = await getDeadlines();

    // Show rounds whose deadline has passed — or all rounds when forceAll (admin)
    const roundOrder = Object.keys(ROUNDS);
    const passedRounds = roundOrder.filter(r => {
      if (forceAll) return true;
      const dl = _deadlines[r];
      return dl?.deadline_at && deadlinePassed(dl.deadline_at);
    });

    // 'tournament' is a special virtual phase (not in ROUNDS)
    const tournamentDl = _deadlines['tournament'];
    const tournamentPassed = forceAll || (tournamentDl?.deadline_at && deadlinePassed(tournamentDl.deadline_at));
    const allPhases = [
      ...(tournamentPassed ? ['tournament'] : []),
      ...passedRounds,
    ];

    if (allPhases.length === 0) {
      container.innerHTML = `
        <div class="compare-empty">
          <div class="compare-empty__icon">🔒</div>
          <p>Todavía no ha cerrado el plazo de ninguna fase.</p>
          <p class="compare-empty__sub">Cuando expire el plazo de cada fase, aquí podrás ver y comparar las predicciones de todos los participantes.</p>
        </div>`;
      return;
    }

    const phaseLabel = (r) => {
      const name = r === 'tournament' ? 'Torneo Final' : escapeHtml(roundLabel(r));
      if (forceAll) return name;
      return `🔒 ${name}`;
    };

    const navHtml = `
      <nav class="compare-phase-nav" role="tablist" aria-label="Seleccionar fase">
        ${allPhases.map((r, i) =>
          `<button class="compare-phase-btn${i === 0 ? ' active' : ''}"
            data-round="${escapeHtml(r)}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}">
            ${phaseLabel(r)}
          </button>`
        ).join('')}
      </nav>
      <div id="compare-content"></div>`;

    container.innerHTML = navHtml;

    container.querySelectorAll('.compare-phase-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.compare-phase-btn').forEach(b => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        loadPhase(btn.dataset.round);
      });
    });

    await loadPhase(allPhases[0]);

  } catch (err) {
    container.innerHTML = `<div class="error">Error: ${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// Phase loader
// ============================================================
async function loadPhase(round) {
  const content = document.getElementById('compare-content');
  if (!content) return;
  content.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    if (round === 'tournament') {
      const [allTournPreds, tournResult, teams] = await Promise.all([
        getAllTournamentPredictions(),
        getTournamentResult(),
        getTeams(),
      ]);
      const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));
      content.innerHTML = buildTournamentView(allTournPreds, tournResult, teamsById);
    } else if (round === 'group') {
      const [matches, groups, teams, allPreds, allGroupPreds, groupPosResults] = await Promise.all([
        getMatches('group'),
        getGroups(),
        getTeams(),
        getAllPredictionsForRound('group'),
        getAllGroupPositionPredictionsAll(),
        getGroupPositionResults(),
      ]);
      matches.sort((a, b) => new Date(a.match_datetime ?? 0) - new Date(b.match_datetime ?? 0));
      content.innerHTML = buildGroupPhaseView(matches, groups, teams, allPreds, allGroupPreds, groupPosResults);
      bindSubnav(content);
    } else {
      const [matches, allPreds] = await Promise.all([
        getMatches(round),
        getAllPredictionsForRound(round),
      ]);
      matches.sort((a, b) => new Date(a.match_datetime ?? 0) - new Date(b.match_datetime ?? 0));
      content.innerHTML = buildMatchPhaseView(matches, allPreds);
    }
  } catch (err) {
    content.innerHTML = `<div class="error">Error al cargar: ${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// Group phase: two sub-sections (results + classification)
// ============================================================
function buildGroupPhaseView(matches, groups, teams, allPreds, allGroupPreds, groupPosResults) {
  const teamsById = Object.fromEntries(teams.map(t => [t.id, t]));
  const matchesHtml   = buildGroupMatchesSection(matches, groups, allPreds);
  const classifHtml   = buildGroupClassifSection(groups, teamsById, allGroupPreds, groupPosResults);

  return `
    <nav class="compare-sub-nav" role="tablist">
      <button class="compare-sub-btn active" data-subtab="resultados" role="tab" aria-selected="true">⚽ Resultados</button>
      <button class="compare-sub-btn" data-subtab="clasificacion" role="tab" aria-selected="false">📋 Clasificación</button>
    </nav>
    <div class="compare-subpanel" id="compare-sub-resultados">${matchesHtml}</div>
    <div class="compare-subpanel hidden" id="compare-sub-clasificacion">${classifHtml}</div>`;
}

function bindSubnav(container) {
  container.querySelectorAll('.compare-sub-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.compare-sub-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      container.querySelectorAll('.compare-subpanel').forEach(p => p.classList.add('hidden'));
      container.querySelector(`#compare-sub-${btn.dataset.subtab}`)?.classList.remove('hidden');
    });
  });
}

// ============================================================
// Matches section (group accordions or flat list)
// ============================================================
function buildGroupMatchesSection(matches, groups, allPreds) {
  const predsByMatch  = groupBy(allPreds, 'match_id');
  const matchesByGroup = groupBy(matches, 'group_id');

  return groups.map(g => {
    const gMatches = matchesByGroup[g.id] ?? [];
    if (!gMatches.length) return '';
    const cardsHtml = gMatches.map(m => buildMatchCard(m, predsByMatch[m.id] ?? [])).join('');
    return `
      <details class="compare-group-accordion">
        <summary class="compare-group-summary">Grupo ${escapeHtml(g.letter)}</summary>
        <div class="compare-group-body">${cardsHtml}</div>
      </details>`;
  }).join('');
}

function buildMatchPhaseView(matches, allPreds) {
  if (!matches.length) return '<div class="empty">No hay partidos en esta fase</div>';
  const predsByMatch = groupBy(allPreds, 'match_id');
  return matches.map(m => buildMatchCard(m, predsByMatch[m.id] ?? [])).join('');
}

// ============================================================
// Single match card
// ============================================================
function buildMatchCard(match, preds) {
  // match comes from getMatches() — match_results already normalized
  const result   = match.match_results ?? null;
  const homeName = match.home_team ? escapeHtml(match.home_team.name) : 'TBD';
  const awayName = match.away_team ? escapeHtml(match.away_team.name) : 'TBD';
  const homeFlag = flagImg(match.home_team);
  const awayFlag = flagImg(match.away_team);

  const resultBadge = result != null
    ? `<span class="compare-result-badge">${result.home_score} – ${result.away_score}</span>`
    : `<span class="compare-result-pending">—</span>`;

  // Current user first, then alphabetical
  const sorted = [...preds].sort((a, b) => {
    if (a.user_id === _currentUser.id) return -1;
    if (b.user_id === _currentUser.id) return 1;
    return (a.user?.username ?? '').localeCompare(b.user?.username ?? '');
  });

  const rowsHtml = sorted.length
    ? sorted.map(p => buildUserPredRow(p, result, match.round)).join('')
    : `<div class="compare-no-preds">Sin predicciones registradas</div>`;

  return `
    <div class="compare-match-card">
      <div class="compare-match-header">
        <span class="compare-match-date">${formatDate(match.match_datetime)}</span>
        <div class="compare-match-teams">
          <span>${homeFlag} ${homeName}</span>
          ${resultBadge}
          <span>${awayName} ${awayFlag}</span>
        </div>
      </div>
      <div class="compare-match-preds">${rowsHtml}</div>
    </div>`;
}

function buildUserPredRow(pred, result, round) {
  const isMe    = pred.user_id === _currentUser.id;
  const hasPred = pred.home_score != null && pred.home_score >= 0
                && pred.away_score != null && pred.away_score >= 0;
  const predText = hasPred ? `${pred.home_score}–${pred.away_score}` : '—';

  let cls = '';
  let icon = '';
  let computedPts = null;
  if (result && hasPred) {
    const pH = pred.home_score, pA = pred.away_score;
    const rH = result.home_score,  rA = result.away_score;
    if (pH === rH && pA === rA) {
      cls = 'result--exact';   icon = '✅';
    } else {
      const pd = pH > pA ? 'H' : pH < pA ? 'A' : 'D';
      const rd = rH > rA ? 'H' : rH < rA ? 'A' : 'D';
      cls = pd === rd ? 'result--partial' : 'result--miss';
      icon = cls === 'result--partial' ? '↗' : '✗';
    }
    // Fallback: compute pts client-side if DB hasn't calculated yet
    computedPts = previewPoints(round ?? 'group', pH, pA, rH, rA);
  }

  // Prefer DB-stored pts (authoritative); fall back to client-side preview
  const ptsVal = (pred.points != null && pred.calculated_at)
    ? pred.points
    : computedPts;
  const ptsText = ptsVal != null ? fmtPts(ptsVal) : '';

  return `
    <div class="compare-user-row${cls ? ' ' + cls : ''}${isMe ? ' compare-user-row--me' : ''}">
      <span class="compare-username">${isMe ? '⭐ Tú' : escapeHtml(pred.user?.username ?? '?')}</span>
      <span class="compare-pred-score">${predText}</span>
      <span class="compare-pred-icon">${icon}</span>
      ${ptsText ? `<span class="compare-pts">${ptsText} pts</span>` : ''}
    </div>`;
}

// ============================================================
// Group classification section
// ============================================================
function buildGroupClassifSection(groups, teamsById, allGroupPreds, groupPosResults) {
  const resultsByGroup = Object.fromEntries(groupPosResults.map(r => [r.group_id, r]));
  const predsByGroup   = {};
  for (const p of allGroupPreds) {
    (predsByGroup[p.group_id] ??= []).push(p);
  }

  const posKeys   = ['pos_1_team_id', 'pos_2_team_id', 'pos_3_team_id', 'pos_4_team_id'];
  const posLabels = ['1.º', '2.º', '3.º', '4.º'];

  const cards = groups.map(group => {
    const result = resultsByGroup[group.id] ?? null;
    const preds  = (predsByGroup[group.id] ?? []).sort((a, b) => {
      if (a.user_id === _currentUser.id) return -1;
      if (b.user_id === _currentUser.id) return 1;
      return (a.user?.username ?? '').localeCompare(b.user?.username ?? '');
    });

    if (!preds.length && !result) return '';

    const teamCell = (teamId) => {
      const t = teamsById[teamId];
      return t ? `${flagImg(t)} <span class="classif-name">${escapeHtml(t.name)}</span>` : '—';
    };

    const resultRow = result ? `
      <tr class="compare-classif-result-row">
        <td><strong>🏆 Oficial</strong></td>
        ${posKeys.map(k => `<td>${teamCell(result[k])}</td>`).join('')}
      </tr>` : '';

    const userRows = preds.map(pred => {
      const isMe  = pred.user_id === _currentUser.id;
      // Compute pts client-side as fallback when DB hasn't calculated yet
      let ptsVal = (pred.points != null && pred.calculated_at) ? pred.points : null;
      if (ptsVal === null && result) {
        const posKeys2 = ['pos_1_team_id', 'pos_2_team_id', 'pos_3_team_id', 'pos_4_team_id'];
        let correct = 0;
        posKeys2.forEach(k => { if (pred[k] && result[k] && pred[k] === result[k]) correct++; });
        ptsVal = correct * 0.5 + (correct === 4 ? 2.0 : 0);
      }
      const pts   = ptsVal != null
        ? `<span class="compare-classif-pts">${fmtPts(ptsVal)} pts</span>` : '';
      const cells = posKeys.map((k) => {
        const t = teamsById[pred[k]];
        let cls = '';
        if (result && pred[k]) {
          cls = pred[k] === result[k]
            ? 'classif-correct'
            : posKeys.some(pk => result[pk] === pred[k]) ? 'classif-partial' : '';
        }
        return `<td class="${cls}">${teamCell(pred[k])}</td>`;
      }).join('');
      return `
        <tr class="${isMe ? 'compare-classif-me' : ''}">
          <td class="compare-classif-username">${isMe ? '⭐ Tú' : escapeHtml(pred.user?.username ?? '?')}${pts}</td>
          ${cells}
        </tr>`;
    }).join('');

    return `
      <details class="compare-group-accordion compare-classif-accordion">
        <summary class="compare-group-summary">Grupo ${escapeHtml(group.letter)}</summary>
        <div class="compare-group-body">
          <div class="compare-classif-card">
            <div class="compare-classif-scroll">
              <table class="compare-classif-table">
                <thead>
                  <tr>
                    <th>Usuario</th>
                    ${posLabels.map(l => `<th>${l}</th>`).join('')}
                  </tr>
                </thead>
                <tbody>${resultRow}${userRows}</tbody>
              </table>
            </div>
          </div>
        </div>
      </details>`;
  }).join('');

  return `<div class="compare-classif">${cards}</div>`;
}

// ============================================================
// Tournament Final comparison view
// ============================================================
function buildTournamentView(preds, result, teamsById) {
  // Current user first, then alphabetical
  const sorted = [...preds].sort((a, b) => {
    if (a.user_id === _currentUser.id) return -1;
    if (b.user_id === _currentUser.id) return 1;
    return (a.user?.username ?? '').localeCompare(b.user?.username ?? '');
  });

  const teamCell = (teamId) => {
    const t = teamsById[teamId];
    return t ? `${flagImg(t)} <span class="classif-name">${escapeHtml(t.name)}</span>` : '<span class="tourn-empty">—</span>';
  };

  // Build official result row
  const hasResult = result && (
    result.champion_team_id || result.runner_up_team_id ||
    result.top_scorer_name
  );

  const resultRow = hasResult ? `
    <tr class="compare-classif-result-row">
      <td><strong>🏆 Oficial</strong></td>
      <td>${teamCell(result.champion_team_id)}</td>
      <td>${teamCell(result.runner_up_team_id)}</td>
      <td>${teamCell(result.champion_team_id)}</td>
      <td class="tourn-scorer-cell">
        ${result.top_scorer_name
          ? `<span class="tourn-scorer-name">${escapeHtml(result.top_scorer_name)}</span>${result.top_scorer_team_id ? ` ${teamCell(result.top_scorer_team_id)}` : ''}`
          : '—'}
      </td>
    </tr>` : '';

  const userRows = sorted.map(pred => {
    const isMe = pred.user_id === _currentUser.id;

    const totalPts = (pred.champion_points ?? 0) + (pred.runner_up_points ?? 0)
                   + (pred.finalist_1_points ?? 0) + (pred.finalist_2_points ?? 0)
                   + (pred.top_scorer_points ?? 0);
    const hasPts = pred.calculated_at && totalPts > 0;

    // Cell CSS: gold border if matched, nothing otherwise
    const matchCls = (predId, officialId) => {
      if (!result || !predId || !officialId) return '';
      return predId === officialId ? 'classif-correct' : '';
    };
    // Finalist: correct if the predicted team reached the final (either slot)
    const finalistCls = (predId) => {
      if (!result || !predId) return '';
      return (predId === result.champion_team_id || predId === result.runner_up_team_id)
        ? 'classif-correct' : '';
    };
    // Top scorer: match on name (case-insensitive)
    const scorerCls = () => {
      if (!result?.top_scorer_name || !pred.top_scorer_name) return '';
      return pred.top_scorer_name.trim().toLowerCase() === result.top_scorer_name.trim().toLowerCase()
        ? 'classif-correct' : '';
    };

    const ptsLabel = hasPts
      ? `<span class="compare-classif-pts">${fmtPts(totalPts)} pts</span>` : '';

    const scorerCell = pred.top_scorer_name
      ? `<span class="tourn-scorer-name">${escapeHtml(pred.top_scorer_name)}</span>${pred.top_scorer_team_id ? ` ${teamCell(pred.top_scorer_team_id)}` : ''}`
      : '—';

    return `
      <tr class="${isMe ? 'compare-classif-me' : ''}">
        <td class="compare-classif-username">${isMe ? '⭐ Tú' : escapeHtml(pred.user?.username ?? '?')}${ptsLabel}</td>
        <td class="${matchCls(pred.champion_team_id, result?.champion_team_id)}">${teamCell(pred.champion_team_id)}</td>
        <td class="${finalistCls(pred.runner_up_team_id)}">${teamCell(pred.runner_up_team_id)}</td>
        <td class="${finalistCls(pred.finalist_2_team_id)}">${teamCell(pred.finalist_2_team_id)}</td>
        <td class="tourn-scorer-cell ${scorerCls()}">${scorerCell}</td>
      </tr>`;
  }).join('');

  if (!sorted.length) {
    return `<div class="compare-empty"><div class="compare-empty__icon">📋</div><p>Nadie ha enviado predicciones de torneo todavía.</p></div>`;
  }

  return `
    <div class="compare-classif-card">
      <div class="compare-classif-scroll">
        <table class="compare-classif-table compare-tourn-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>🏆 Campeón</th>
              <th>🏅 Finalista A</th>
              <th>🏅 Finalista B</th>
              <th>⚽ Máx. Goleador</th>
            </tr>
          </thead>
          <tbody>${resultRow}${userRows}</tbody>
        </table>
      </div>
    </div>`;
}
