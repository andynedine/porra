// =============================================================
// admin.js — SUPERADMIN panel logic
// =============================================================
import {
  getMatches, getTeams, getGroups,
  upsertMatchResult, upsertMatch,
  getDeadlines, upsertDeadline,
  getAllUserPredictions, adminUpdatePrediction,
  getChangeLogs, getAllUsers, updateUserRole,
  getTournamentResult, upsertTournamentResult,
  getStandings, adminRecalculateAllScores,
} from './api.js';
import {
  formatDate, escapeHtml, showToast, roundLabel, deadlinePassed, groupBy, flagImg,
} from './utils.js';
import { ROUNDS } from './config.js';

// ============================================================
// FLAG-SELECT HELPERS (shared with admin forms)
// ============================================================
function buildFlagSelect(name, teamsList, selectedId) {
  const sid = String(selectedId ?? '');
  const selected = teamsList.find(t => String(t.id) === sid);
  const display = selected
    ? `${flagImg(selected)} ${escapeHtml(selected.name)}`
    : '— Seleccionar —';
  const options = teamsList.map(t =>
    `<div class="flag-option" data-value="${t.id}" role="option">${flagImg(t)} ${escapeHtml(t.name)}</div>`
  ).join('');
  return `
    <div class="flag-select" data-name="${escapeHtml(name)}">
      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(sid)}">
      <button type="button" class="flag-select__trigger" aria-haspopup="listbox">
        <span class="flag-select__value">${display}</span>
        <span class="flag-select__arrow">▾</span>
      </button>
      <div class="flag-select__dropdown" role="listbox" hidden>
        <div class="flag-option flag-option--empty" data-value="" role="option">— Seleccionar —</div>
        ${options}
      </div>
    </div>`;
}

function bindFlagSelects(container) {
  container.querySelectorAll('.flag-select').forEach(sel => {
    const trigger   = sel.querySelector('.flag-select__trigger');
    const dropdown  = sel.querySelector('.flag-select__dropdown');
    const hidden    = sel.querySelector('input[type="hidden"]');
    const valueSpan = sel.querySelector('.flag-select__value');
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      document.querySelectorAll('.flag-select__dropdown').forEach(d => { d.hidden = true; });
      dropdown.hidden = isOpen;
    });
    dropdown.addEventListener('click', e => {
      const opt = e.target.closest('.flag-option');
      if (!opt) return;
      hidden.value = opt.dataset.value;
      valueSpan.innerHTML = opt.innerHTML;
      dropdown.hidden = true;
    });
  });
  document.addEventListener('click', () => {
    container.querySelectorAll('.flag-select__dropdown').forEach(d => { d.hidden = true; });
  });
}

let _teams = [];
let _groups = [];

export async function initAdmin() {
  try {
    [_teams, _groups] = await Promise.all([getTeams(), getGroups()]);
    bindAdminTabs();
    await renderAdminResultsTab();
  } catch (err) {
    showToast('Error al cargar panel admin: ' + err.message, 'error');
  }
}

// ============================================================
// TABS
// ============================================================
function bindAdminTabs() {
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => activateAdminTab(tab));
  });
}

function activateAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.admin-panel').forEach(p => p.classList.add('hidden'));
  tab.classList.add('active');
  const panel = document.getElementById(`admin-panel-${tab.dataset.panel}`);
  if (panel) {
    panel.classList.remove('hidden');
    loadAdminPanel(tab.dataset.panel);
  }
}

async function loadAdminPanel(panel) {
  switch (panel) {
    case 'results':    await renderAdminResultsTab(); break;
    case 'matches':    await renderAdminMatchesTab(); break;
    case 'deadlines':  await renderAdminDeadlinesTab(); break;
    case 'predictions':await renderAdminPredictionsTab(); break;
    case 'logs':       await renderAdminLogsTab(); break;
    case 'users':      await renderAdminUsersTab(); break;
    case 'tournament': await renderAdminTournamentTab(); break;
  }
}

// ============================================================
// RESULTS — Enter official match results
// ============================================================
async function renderAdminResultsTab() {
  const container = document.getElementById('admin-panel-results');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    const matches = await getMatches();
    const rounds = Object.keys(ROUNDS);

    let html = `
      <div class="admin-results-header">
        <h2>Introducir Resultados</h2>
        <button id="btn-recalc-scores" class="btn btn--outline btn--sm">&#x21BB; Recalcular puntuaciones</button>
      </div>`;

    for (const round of rounds) {
      const roundMatches = matches.filter(m => m.round === round);
      if (!roundMatches.length) continue;

      html += `<details class="admin-round-details">
        <summary class="admin-round-summary">${escapeHtml(roundLabel(round))} (${roundMatches.length} partidos)</summary>
        <div class="admin-matches-list">`;

      for (const m of roundMatches) {
        const res = m.match_results ?? null;
        const homeTeam = m.home_team?.name ?? 'TBD';
        const awayTeam = m.away_team?.name ?? 'TBD';
        const homeFlag = flagImg(m.home_team);
        const awayFlag = flagImg(m.away_team);

        html += `
          <div class="admin-match-row ${res ? 'admin-match-row--done' : ''}" id="admin-match-${m.id}">
            <div class="admin-match-info">
              <span class="match-datetime">${formatDate(m.match_datetime)}</span>
              ${m.group ? `<span class="match-group">Grupo ${escapeHtml(m.group.letter)}</span>` : ''}
            </div>
            <form class="admin-result-form" data-match="${m.id}" data-round="${escapeHtml(round)}">
              <span class="team-label">${homeFlag} ${escapeHtml(homeTeam)}</span>
              <input type="number" name="home_score" min="0" max="99" class="score-input admin-score"
                value="${res ? res.home_score : ''}" placeholder="–" required>
              <span class="sep">–</span>
              <input type="number" name="away_score" min="0" max="99" class="score-input admin-score"
                value="${res ? res.away_score : ''}" placeholder="–" required>
              <span class="team-label">${awayFlag} ${escapeHtml(awayTeam)}</span>
              <button type="submit" class="btn btn--sm btn--primary">
                ${res ? '✏️ Actualizar' : '✅ Guardar'}
              </button>
            </form>
          </div>`;
      }

      html += '</div></details>';
    }

    container.innerHTML = html;

    // Recalculate all scores button
    document.getElementById('btn-recalc-scores')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Recalculando…';
      try {
        const msg = await adminRecalculateAllScores();
        showToast(msg ?? 'Puntuaciones recalculadas', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      } finally {
        btn.disabled = false;
        btn.innerHTML = '&#x21BB; Recalcular puntuaciones';
      }
    });

    // Bind form submits
    container.querySelectorAll('.admin-result-form').forEach(form => {
      form.addEventListener('submit', handleResultSubmit);
    });

  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

async function handleResultSubmit(e) {
  e.preventDefault();
  const form     = e.target;
  const matchId  = parseInt(form.dataset.match, 10);
  const fd       = new FormData(form);
  const homeScore = parseInt(fd.get('home_score'), 10);
  const awayScore = parseInt(fd.get('away_score'), 10);

  if (isNaN(homeScore) || isNaN(awayScore)) {
    showToast('Introduce marcadores válidos', 'warning');
    return;
  }

  const btn = form.querySelector('[type="submit"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }

  try {
    await upsertMatchResult(matchId, homeScore, awayScore);
    const row = document.getElementById(`admin-match-${matchId}`);
    if (row) row.classList.add('admin-match-row--done');
    showToast('Resultado guardado y puntuaciones actualizadas', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '✏️ Actualizar'; }
  }
}

// ============================================================
// MATCHES — CRUD
// ============================================================
async function renderAdminMatchesTab() {
  const container = document.getElementById('admin-panel-matches');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    const matches = await getMatches();

    // Sort by round order then by date
    const ROUND_ORDER = Object.fromEntries(
      Object.entries(ROUNDS).map(([k, v]) => [k, v.order])
    );
    matches.sort((a, b) => {
      const rA = ROUND_ORDER[a.round] ?? 99;
      const rB = ROUND_ORDER[b.round] ?? 99;
      if (rA !== rB) return rA - rB;
      if (a.round === 'group' && b.round === 'group') {
        const gA = a.group?.letter ?? '';
        const gB = b.group?.letter ?? '';
        if (gA !== gB) return gA.localeCompare(gB);
      }
      return new Date(a.match_datetime ?? 0) - new Date(b.match_datetime ?? 0);
    });

    // Group matches by round, preserving round order
    const matchesByRound = {};
    for (const round of Object.keys(ROUNDS)) {
      const rms = matches.filter(m => m.round === round);
      if (rms.length) matchesByRound[round] = rms;
    }

    function matchRow(m) {
      const homeTeam = m.home_team ? `${flagImg(m.home_team)} ${escapeHtml(m.home_team.name)}` : 'TBD';
      const awayTeam = m.away_team ? `${flagImg(m.away_team)} ${escapeHtml(m.away_team.name)}` : 'TBD';
      return `
        <tr>
          <td>${m.id}</td>
          <td>${m.group ? 'Grupo ' + escapeHtml(m.group.letter) : '—'}</td>
          <td>${homeTeam}</td>
          <td>${awayTeam}</td>
          <td>${formatDate(m.match_datetime)}</td>
          <td>
            <button class="btn btn--xs btn--outline edit-match-btn"
              data-id="${m.id}"
              data-round="${m.round}"
              data-group-id="${m.group_id ?? ''}"
              data-home="${m.home_team_id ?? ''}"
              data-away="${m.away_team_id ?? ''}"
              data-dt="${m.match_datetime ?? ''}">
              ✏️ Editar
            </button>
          </td>
        </tr>`;
    }

    let html = '<h2>Gestión de Partidos</h2>';
    for (const [round, rms] of Object.entries(matchesByRound)) {
      html += `
        <details class="admin-round-details">
          <summary class="admin-round-summary">${escapeHtml(roundLabel(round))} (${rms.length} partidos)</summary>
          <div style="overflow-x:auto;padding:0 16px 16px">
            <table class="admin-table">
              <thead><tr><th>ID</th><th>Grupo</th><th>Local</th><th>Visitante</th><th>Fecha</th><th>Acción</th></tr></thead>
              <tbody>${rms.map(matchRow).join('')}</tbody>
            </table>
          </div>
        </details>`;
    }
    container.innerHTML = html;

    // --- modal ---
    let modal = document.getElementById('match-edit-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'match-edit-modal';
      modal.className = 'admin-modal-overlay hidden';
      modal.innerHTML = `<div class="admin-modal"><div id="match-edit-modal-body"></div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click', e => {
        if (e.target === modal) modal.classList.add('hidden');
      });
    }

    function bindEditButtons() {
      container.querySelectorAll('.edit-match-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const dtLocal = btn.dataset.dt ? btn.dataset.dt.slice(0, 16).replace(' ', 'T') : '';
          const body = modal.querySelector('#match-edit-modal-body');
          body.innerHTML = `
            <div class="admin-modal__header">
              <h3>Editar Partido #${escapeHtml(btn.dataset.id)}</h3>
              <button type="button" class="admin-modal__close" id="modal-close-btn">✕</button>
            </div>
            <form id="match-edit-form" class="admin-form">
              <input type="hidden" name="id"       value="${escapeHtml(btn.dataset.id)}">
              <input type="hidden" name="round"    value="${escapeHtml(btn.dataset.round)}">
              <input type="hidden" name="group_id" value="${escapeHtml(btn.dataset.groupId)}">
              <div class="form-row">
                <label>Local
                  ${buildFlagSelect('home_team_id', _teams, btn.dataset.home)}
                </label>
                <label>Visitante
                  ${buildFlagSelect('away_team_id', _teams, btn.dataset.away)}
                </label>
              </div>
              <div class="form-row">
                <label>Fecha/Hora (UTC)
                  <input type="datetime-local" name="match_datetime" value="${escapeHtml(dtLocal)}">
                </label>
              </div>
              <div class="form-row">
                <button type="submit" class="btn btn--primary">💾 Guardar</button>
                <button type="button" id="cancel-edit-match" class="btn btn--outline">Cancelar</button>
              </div>
            </form>`;

          bindFlagSelects(body);
          modal.classList.remove('hidden');

          const closeModal = () => modal.classList.add('hidden');
          body.querySelector('#modal-close-btn').addEventListener('click', closeModal);
          body.querySelector('#cancel-edit-match').addEventListener('click', closeModal);

          body.querySelector('#match-edit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            const submitBtn = e.target.querySelector('[type="submit"]');
            if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="spinner"></span>'; }
            try {
              await upsertMatch({
                id:             parseInt(fd.get('id'), 10),
                round:          fd.get('round'),
                group_id:       parseInt(fd.get('group_id')) || null,
                home_team_id:   parseInt(fd.get('home_team_id')) || null,
                away_team_id:   parseInt(fd.get('away_team_id')) || null,
                match_datetime: fd.get('match_datetime') ? fd.get('match_datetime').replace('T', ' ') + ':00+00' : null,
              });
              showToast('Partido actualizado', 'success');
              closeModal();
              await renderAdminMatchesTab();
            } catch (err) {
              showToast('Error: ' + err.message, 'error');
              if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = '💾 Guardar'; }
            }
          });
        });
      });
    }

    bindEditButtons();

  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// DEADLINES
// ============================================================
async function renderAdminDeadlinesTab() {
  const container = document.getElementById('admin-panel-deadlines');
  if (!container) return;

  try {
    const deadlines = await getDeadlines();
    const rounds = ['tournament', ...Object.keys(ROUNDS)];

    let html = '<h2>Fechas Límite</h2><form id="deadlines-form" class="admin-form">';
    for (const round of rounds) {
      const dl = deadlines[round];
      const localVal = dl ? dl.deadline_at.slice(0, 16).replace(' ', 'T') : '';
      html += `
        <div class="form-row">
          <label>${escapeHtml(round === 'tournament' ? 'Torneo (campeón/goleador)' : roundLabel(round))}
            <input type="datetime-local" name="${escapeHtml(round)}" value="${escapeHtml(localVal)}">
          </label>
        </div>`;
    }
    html += '<button type="submit" class="btn btn--primary">💾 Guardar Fechas Límite</button></form>';
    container.innerHTML = html;

    container.querySelector('#deadlines-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
      try {
        for (const round of rounds) {
          const val = fd.get(round);
          if (val) await upsertDeadline(round, val + ':00+00:00'); // proper ISO 8601 with T and +00:00
        }
        showToast('Fechas límite actualizadas', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '💾 Guardar Fechas Límite'; }
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// USER PREDICTIONS (admin edit)
// ============================================================
async function renderAdminPredictionsTab() {
  const container = document.getElementById('admin-panel-predictions');
  if (!container) return;
  container.innerHTML = `
    <h2>Editar Predicciones de Usuarios</h2>
    <div class="form-row">
      <label>Seleccionar partido:
        <select id="admin-match-select"><option value="">Cargando…</option></select>
      </label>
    </div>
    <div id="admin-preds-list"></div>`;

  try {
    const matches = await getMatches();
    const sel = container.querySelector('#admin-match-select');
    sel.innerHTML = '<option value="">— Seleccionar partido —</option>' +
      matches.map(m => {
        const h = m.home_team?.name ?? 'TBD';
        const a = m.away_team?.name ?? 'TBD';
        return `<option value="${m.id}">${escapeHtml(roundLabel(m.round))} — ${escapeHtml(h)} vs ${escapeHtml(a)} (${formatDate(m.match_datetime)})</option>`;
      }).join('');

    sel.addEventListener('change', async () => {
      const matchId = parseInt(sel.value, 10);
      if (!matchId) return;
      const listDiv = container.querySelector('#admin-preds-list');
      listDiv.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
      try {
        const preds = await getAllUserPredictions(matchId);
        if (!preds.length) { listDiv.innerHTML = '<div class="empty">No hay predicciones para este partido</div>'; return; }

        listDiv.innerHTML = `
          <table class="admin-table">
            <thead><tr><th>Usuario</th><th>Local</th><th>Visitante</th><th>Pts</th><th>Acción</th></tr></thead>
            <tbody>
              ${preds.map(p => `
                <tr id="admin-pred-row-${p.id}">
                  <td>${escapeHtml(p.user?.username ?? p.user_id)}</td>
                  <td><input type="number" class="score-input admin-score" value="${p.home_score >= 0 ? p.home_score : ''}" min="0" max="99" data-pred="${p.id}" data-side="home"></td>
                  <td><input type="number" class="score-input admin-score" value="${p.away_score >= 0 ? p.away_score : ''}" min="0" max="99" data-pred="${p.id}" data-side="away"></td>
                  <td>${p.points}</td>
                  <td><button class="btn btn--xs btn--primary save-pred-btn" data-pred="${p.id}">💾</button></td>
                </tr>`).join('')}
            </tbody>
          </table>`;

        listDiv.querySelectorAll('.save-pred-btn').forEach(btn => {
          btn.addEventListener('click', async () => {
            const predId = parseInt(btn.dataset.pred, 10);
            const row = document.getElementById(`admin-pred-row-${predId}`);
            const h = parseInt(row.querySelector('[data-side="home"]').value, 10);
            const a = parseInt(row.querySelector('[data-side="away"]').value, 10);
            if (isNaN(h) || isNaN(a)) { showToast('Valores inválidos', 'warning'); return; }
            btn.disabled = true;
            try {
              await adminUpdatePrediction(predId, h, a);
              showToast('Predicción actualizada', 'success');
            } catch (err) {
              showToast('Error: ' + err.message, 'error');
            } finally { btn.disabled = false; }
          });
        });
      } catch (err) {
        listDiv.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// CHANGE LOGS
// ============================================================
async function renderAdminLogsTab() {
  const container = document.getElementById('admin-panel-logs');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const logs = await getChangeLogs(200);
    if (!logs.length) { container.innerHTML = '<div class="empty">Sin cambios registrados</div>'; return; }
    container.innerHTML = `
      <h2>Historial de Cambios</h2>
      <table class="admin-table admin-table--compact">
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Tabla</th><th>Registro</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          ${logs.map(l => `
            <tr>
              <td>${formatDate(l.created_at)}</td>
              <td>${escapeHtml(l.user?.username ?? l.changed_by ?? 'Sistema')}</td>
              <td>${escapeHtml(l.table_name)}</td>
              <td>${escapeHtml(l.record_id)}</td>
              <td><span class="badge badge--${l.action.toLowerCase()}">${escapeHtml(l.action)}</span></td>
              <td>
                <details>
                  <summary>Ver</summary>
                  <pre class="log-json">${escapeHtml(JSON.stringify({ old: l.old_data, new: l.new_data }, null, 2))}</pre>
                </details>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// USERS
// ============================================================
async function renderAdminUsersTab() {
  const container = document.getElementById('admin-panel-users');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  try {
    const users = await getAllUsers();
    container.innerHTML = `
      <h2>Gestión de Usuarios</h2>
      <table class="admin-table">
        <thead><tr><th>Usuario</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Registro</th><th>Acción</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.phone ?? '—')}</td>
              <td>
                <select class="role-select" data-user="${u.id}">
                  <option value="USER"       ${u.role === 'USER'       ? 'selected' : ''}>USER</option>
                  <option value="SUPERADMIN" ${u.role === 'SUPERADMIN' ? 'selected' : ''}>SUPERADMIN</option>
                </select>
              </td>
              <td>${formatDate(u.created_at, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td>
                <button class="btn btn--xs btn--primary save-role-btn" data-user="${u.id}">💾 Guardar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    container.querySelectorAll('.save-role-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.user;
        const role = container.querySelector(`.role-select[data-user="${userId}"]`).value;
        btn.disabled = true;
        try {
          await updateUserRole(userId, role);
          showToast('Rol actualizado', 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        } finally { btn.disabled = false; }
      });
    });
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

// ============================================================
// TOURNAMENT RESULTS
// ============================================================
async function renderAdminTournamentTab() {
  const container = document.getElementById('admin-panel-tournament');
  if (!container) return;
  try {
    const result = await getTournamentResult();
    container.innerHTML = `
      <h2>Resultado del Torneo</h2>
      <form id="tournament-result-form" class="admin-form">
        <div class="form-row"><div>
          <label>🥇 Campeón</label>
          ${buildFlagSelect('champion_team_id', _teams, result?.champion_team_id ?? null)}
          </div><div><label>🥈 Subcampeón</label>
          ${buildFlagSelect('runner_up_team_id', _teams, result?.runner_up_team_id ?? null)}
        </div>
        <div class="form-row">
          <label>⚽ Máximo Goleador
            <input type="text" name="top_scorer_name" maxlength="100" value="${escapeHtml(result?.top_scorer_name ?? '')}">
          </label>
        </div>
        <button type="submit" class="btn btn--gold">💾 Guardar Resultado del Torneo</button>
      </form>`;

    bindFlagSelects(container);

    container.querySelector('#tournament-result-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
      try {
        await upsertTournamentResult({
          champion_team_id:  parseInt(fd.get('champion_team_id'))  || null,
          runner_up_team_id: parseInt(fd.get('runner_up_team_id')) || null,
          top_scorer_name:   fd.get('top_scorer_name')             || null,
        });
        showToast('Resultado del torneo guardado — puntuaciones de torneo actualizadas automáticamente', 'success');
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = '💾 Guardar Resultado del Torneo'; }
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}
