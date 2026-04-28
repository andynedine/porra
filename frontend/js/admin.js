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
  getStandings,
} from './api.js';
import {
  formatDate, escapeHtml, showToast, roundLabel, deadlinePassed, groupBy, flagImg,
} from './utils.js';
import { ROUNDS } from './config.js';

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

    let html = '<h2>Introducir Resultados</h2>';

    for (const round of rounds) {
      const roundMatches = matches.filter(m => m.round === round);
      if (!roundMatches.length) continue;

      html += `<details class="admin-round-details" open>
        <summary class="admin-round-summary">${escapeHtml(roundLabel(round))} (${roundMatches.length} partidos)</summary>
        <div class="admin-matches-list">`;

      for (const m of roundMatches) {
        const res = m.match_results?.[0] ?? null;
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
              <span class="team-label">${escapeHtml(awayTeam)} ${escapeHtml(awayFlag)}</span>
              <div class="extra-fields ${res?.penalties ? '' : 'hidden'}" id="extra-${m.id}">
                <label><input type="checkbox" name="extra_time" ${res?.extra_time ? 'checked' : ''}> Prórroga</label>
                <label><input type="checkbox" name="penalties" ${res?.penalties ? 'checked' : ''}> Penaltis</label>
                <span>Pen:</span>
                <input type="number" name="home_pen" min="0" max="20" class="score-input admin-score--sm" value="${res?.home_pen_score ?? ''}">
                <span>–</span>
                <input type="number" name="away_pen" min="0" max="20" class="score-input admin-score--sm" value="${res?.away_pen_score ?? ''}">
              </div>
              <button type="button" class="btn btn--xs btn--outline toggle-extra" data-match="${m.id}">
                ${round !== 'group' ? '+ Extra/Pen' : ''}
              </button>
              <button type="submit" class="btn btn--sm btn--primary">
                ${res ? '✏️ Actualizar' : '✅ Guardar'}
              </button>
            </form>
          </div>`;
      }

      html += '</div></details>';
    }

    container.innerHTML = html;

    // Bind form submits
    container.querySelectorAll('.admin-result-form').forEach(form => {
      form.addEventListener('submit', handleResultSubmit);
    });

    // Toggle extra fields
    container.querySelectorAll('.toggle-extra').forEach(btn => {
      btn.addEventListener('click', () => {
        const extra = document.getElementById(`extra-${btn.dataset.match}`);
        if (extra) extra.classList.toggle('hidden');
      });
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
    await upsertMatchResult(matchId, homeScore, awayScore, {
      extra_time:     fd.get('extra_time') === 'on',
      penalties:      fd.get('penalties') === 'on',
      home_pen_score: parseInt(fd.get('home_pen')) || null,
      away_pen_score: parseInt(fd.get('away_pen')) || null,
    });
    const row = document.getElementById(`admin-match-${matchId}`);
    if (row) row.classList.add('admin-match-row--done');
    showToast('✅ Resultado guardado y puntuaciones actualizadas', 'success');
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
    const teamOptions = _teams.map(t => `<option value="${t.id}">${escapeHtml(t.flag)} ${escapeHtml(t.name)}</option>`).join('');

    let html = `
      <h2>Gestión de Partidos</h2>
      <table class="admin-table">
        <thead>
          <tr><th>ID</th><th>Ronda</th><th>Grupo</th><th>Local</th><th>Visitante</th><th>Fecha</th><th>Estadio</th><th>Acción</th></tr>
        </thead>
        <tbody>`;

    for (const m of matches) {
      const homeTeam = m.home_team ? `${flagImg(m.home_team)} ${escapeHtml(m.home_team.name)}` : 'TBD';
      const awayTeam = m.away_team ? `${flagImg(m.away_team)} ${escapeHtml(m.away_team.name)}` : 'TBD';
      html += `
        <tr>
          <td>${m.id}</td>
          <td>${escapeHtml(roundLabel(m.round))}</td>
          <td>${m.group ? 'Grupo ' + m.group.letter : '—'}</td>
          <td>${escapeHtml(homeTeam)}</td>
          <td>${escapeHtml(awayTeam)}</td>
          <td>${formatDate(m.match_datetime)}</td>
          <td>${escapeHtml(m.venue ?? '—')}</td>
          <td>
            <button class="btn btn--xs btn--outline edit-match-btn"
              data-id="${m.id}"
              data-home="${m.home_team_id ?? ''}"
              data-away="${m.away_team_id ?? ''}"
              data-dt="${m.match_datetime ?? ''}"
              data-venue="${escapeHtml(m.venue ?? '')}">
              ✏️ Editar
            </button>
          </td>
        </tr>`;
    }

    html += `
        </tbody>
      </table>
      <!-- Inline edit form (shown on button click) -->
      <div id="match-edit-form-wrapper" class="hidden">
        <h3>Editar Partido</h3>
        <form id="match-edit-form" class="admin-form">
          <input type="hidden" name="id">
          <div class="form-row">
            <label>Local
              <select name="home_team_id"><option value="">TBD</option>${teamOptions}</select>
            </label>
            <label>Visitante
              <select name="away_team_id"><option value="">TBD</option>${teamOptions}</select>
            </label>
          </div>
          <div class="form-row">
            <label>Fecha/Hora (UTC)
              <input type="datetime-local" name="match_datetime">
            </label>
            <label>Estadio
              <input type="text" name="venue" maxlength="100">
            </label>
          </div>
          <div class="form-row">
            <button type="submit" class="btn btn--primary">💾 Guardar</button>
            <button type="button" id="cancel-edit-match" class="btn btn--outline">Cancelar</button>
          </div>
        </form>
      </div>`;

    container.innerHTML = html;

    // Edit buttons
    container.querySelectorAll('.edit-match-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrapper = container.querySelector('#match-edit-form-wrapper');
        const form    = container.querySelector('#match-edit-form');
        wrapper.classList.remove('hidden');
        form.querySelector('[name="id"]').value = btn.dataset.id;
        form.querySelector('[name="home_team_id"]').value = btn.dataset.home;
        form.querySelector('[name="away_team_id"]').value = btn.dataset.away;
        form.querySelector('[name="venue"]').value = btn.dataset.venue;
        if (btn.dataset.dt) {
          const local = new Date(btn.dataset.dt).toISOString().slice(0, 16);
          form.querySelector('[name="match_datetime"]').value = local;
        }
        wrapper.scrollIntoView({ behavior: 'smooth' });
      });
    });

    container.querySelector('#cancel-edit-match')?.addEventListener('click', () => {
      container.querySelector('#match-edit-form-wrapper').classList.add('hidden');
    });

    container.querySelector('#match-edit-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
      try {
        await upsertMatch({
          id:             parseInt(fd.get('id'), 10),
          home_team_id:   parseInt(fd.get('home_team_id')) || null,
          away_team_id:   parseInt(fd.get('away_team_id')) || null,
          match_datetime: fd.get('match_datetime') ? new Date(fd.get('match_datetime')).toISOString() : null,
          venue:          fd.get('venue') || null,
        });
        showToast('✅ Partido actualizado', 'success');
        await renderAdminMatchesTab();
      } catch (err) {
        showToast('Error: ' + err.message, 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = '💾 Guardar'; }
      }
    });
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
      const localVal = dl ? new Date(dl.deadline_at).toISOString().slice(0, 16) : '';
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
          if (val) await upsertDeadline(round, new Date(val).toISOString());
        }
        showToast('✅ Fechas límite actualizadas', 'success');
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
              showToast('✅ Predicción actualizada', 'success');
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
          showToast('✅ Rol actualizado', 'success');
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
  const teamOptions = _teams.map(t => `<option value="${t.id}">${escapeHtml(t.flag)} ${escapeHtml(t.name)}</option>`).join('');
  try {
    const result = await getTournamentResult();
    container.innerHTML = `
      <h2>Resultado del Torneo</h2>
      <form id="tournament-result-form" class="admin-form">
        <div class="form-row">
          <label>🥇 Campeón
            <select name="champion_team_id"><option value="">—</option>${teamOptions}</select>
          </label>
          <label>🥈 Subcampeón
            <select name="runner_up_team_id"><option value="">—</option>${teamOptions}</select>
          </label>
          <label>🥉 Tercer Puesto
            <select name="third_place_team_id"><option value="">—</option>${teamOptions}</select>
          </label>
        </div>
        <div class="form-row">
          <label>⚽ Máximo Goleador
            <input type="text" name="top_scorer_name" maxlength="100" value="${escapeHtml(result?.top_scorer_name ?? '')}">
          </label>
          <label>Goles
            <input type="number" name="top_scorer_goals" min="0" max="99" value="${result?.top_scorer_goals ?? ''}">
          </label>
        </div>
        <button type="submit" class="btn btn--gold">💾 Guardar Resultado del Torneo</button>
      </form>`;

    // Pre-select existing values
    if (result) {
      container.querySelector('[name="champion_team_id"]').value    = result.champion_team_id    ?? '';
      container.querySelector('[name="runner_up_team_id"]').value   = result.runner_up_team_id   ?? '';
      container.querySelector('[name="third_place_team_id"]').value = result.third_place_team_id ?? '';
    }

    container.querySelector('#tournament-result-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd  = new FormData(e.target);
      const btn = e.target.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
      try {
        await upsertTournamentResult({
          champion_team_id:    parseInt(fd.get('champion_team_id'))    || null,
          runner_up_team_id:   parseInt(fd.get('runner_up_team_id'))   || null,
          third_place_team_id: parseInt(fd.get('third_place_team_id')) || null,
          top_scorer_name:     fd.get('top_scorer_name')               || null,
          top_scorer_goals:    parseInt(fd.get('top_scorer_goals'))    || null,
        });
        showToast('✅ Resultado del torneo guardado', 'success');
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
