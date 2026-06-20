// =============================================================
// admin.js — SUPERADMIN panel logic
// =============================================================
import {
  getMatches, getTeams, getGroups,
  upsertMatchResult, upsertMatch,
  getDeadlines, upsertDeadline,
  getAllUsers, updateUserRole, updateUserAdmitido, deleteUsers,
  getTournamentResult, upsertTournamentResult,
  getGroupPositionResults, upsertGroupPositionResult,
  getStandings, adminRecalculateAllScores,
} from './api.js';
import {
  formatDate, escapeHtml, showToast, roundLabel, deadlinePassed, groupBy, flagImg,
} from './utils.js';
import { ROUNDS } from './config.js';
import { initAdminCompare } from './compare.js';

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
let _adminUser = null;

export async function initAdmin(user) {
  _adminUser = user;
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
    case 'predictions': await renderAdminPredictionsTab(); break;
    case 'users':      await renderAdminUsersTab(); break;
  }
}

// ============================================================
// RESULTS — Sub-nav: Resultado final / Clasificación / Por fases
// ============================================================
async function renderAdminResultsTab() {
  const container = document.getElementById('admin-panel-results');
  if (!container) return;

  container.innerHTML = `
    <nav class="admin-subnav" role="tablist">
      <button class="admin-subtab active" role="tab" data-subpanel="phases" aria-selected="true">✅ Resultados por fases</button>
      <button class="admin-subtab" role="tab" data-subpanel="final" aria-selected="false">🏆 Resultado final</button>
      <button class="admin-subtab" role="tab" data-subpanel="classification" aria-selected="false">📊 Clasificación Fase Regular</button>
    </nav>
    <div id="admin-results-subpanel-phases" class="admin-subpanel"></div>
    <div id="admin-results-subpanel-final" class="admin-subpanel hidden"></div>
    <div id="admin-results-subpanel-classification" class="admin-subpanel hidden"></div>`;

  container.querySelectorAll('.admin-subtab').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.admin-subtab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      container.querySelectorAll('.admin-subpanel').forEach(p => p.classList.add('hidden'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const subPanel = document.getElementById(`admin-results-subpanel-${btn.dataset.subpanel}`);
      if (subPanel) {
        subPanel.classList.remove('hidden');
        if (!subPanel.dataset.loaded) {
          await loadAdminResultsSubpanel(btn.dataset.subpanel, subPanel);
        }
      }
    });
  });

  const initialPanel = document.getElementById('admin-results-subpanel-phases');
  await loadAdminResultsSubpanel('phases', initialPanel);
}

async function loadAdminResultsSubpanel(subpanel, panel) {
  panel.dataset.loaded = '1';
  panel.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  switch (subpanel) {
    case 'phases':         await renderResultsByPhaseSubpanel(panel); break;
    case 'final':          await renderResultsFinalSubpanel(panel); break;
    case 'classification': await renderResultsClassificationSubpanel(panel); break;
  }
}

async function renderResultsByPhaseSubpanel(panel) {
  try {
    const matches = await getMatches();
    const rounds = Object.keys(ROUNDS);

    let html = `
      <div class="admin-results-header">
        <h2>Introducir Resultados</h2>
        <button id="btn-recalc-scores" class="btn btn--outline btn--sm">&#x21BB; Recalcular puntuaciones</button>
      </div>`;

    for (const round of rounds) {
      const roundMatches = matches
        .filter(m => m.round === round)
        .sort((a, b) => new Date(a.match_datetime ?? 0) - new Date(b.match_datetime ?? 0));
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
            <form class="admin-result-form" data-match="${m.id}" data-round="${escapeHtml(round)}">
              <div class="admin-match-info">
                <div class="admin-match-meta">
                  <span class="match-datetime">${formatDate(m.match_datetime)}</span>
                  ${m.group ? `<span class="match-group">Grupo ${escapeHtml(m.group.letter)}</span>` : ''}
                </div>
                <button type="submit" class="btn btn--xs btn--primary admin-save-btn">
                  ${res ? '✏️ Actualizar' : '✅ Guardar'}
                </button>
              </div>
              <div class="admin-result-grid">
                <span class="team-label">${homeFlag} ${escapeHtml(homeTeam)}</span>
                <input type="number" name="home_score" min="0" max="99" class="score-input admin-score"
                  value="${res ? res.home_score : ''}" placeholder="–" required>
                <span class="sep">–</span>
                <input type="number" name="away_score" min="0" max="99" class="score-input admin-score"
                  value="${res ? res.away_score : ''}" placeholder="–" required>
                <span class="team-label">${awayFlag} ${escapeHtml(awayTeam)}</span>
              </div>
            </form>
          </div>`;
      }

      html += '</div></details>';
    }

    panel.innerHTML = html;

    // Recalculate all scores button
    panel.querySelector('#btn-recalc-scores')?.addEventListener('click', async (e) => {
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
    panel.querySelectorAll('.admin-result-form').forEach(form => {
      form.addEventListener('submit', handleResultSubmit);
    });

  } catch (err) {
    panel.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
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
// VER TODOS — superadmin view (all phases, no deadline gate)
// ============================================================
async function renderAdminPredictionsTab() {
  // _adminUser is stored when initAdmin is called — pass it through
  await initAdminCompare(_adminUser);
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
      <p class="admin-users-hint">El campo <strong>Admitido</strong> controla si el usuario puede introducir predicciones. Los usuarios deben ser admitidos manualmente por un superadministrador.</p>
      <div class="admin-users-toolbar">
        <label class="admin-select-all-label">
          <input type="checkbox" id="users-select-all"> Seleccionar todos
        </label>
        <button class="btn btn--xs btn--danger" id="delete-selected-btn" disabled>🗑️ Borrar seleccionados</button>
      </div>
      <table class="admin-table admin-users-table">
        <thead><tr><th></th><th>Usuario</th><th>Email</th><th>Teléfono</th><th>Rol</th><th>Admitido</th><th>Registro</th><th>Acción</th></tr></thead>
        <tbody>
          ${users.map(u => `
            <tr id="user-row-${u.id}">
              <td><input type="checkbox" class="user-select-cb" data-user="${u.id}"></td>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.email)}</td>
              <td>${escapeHtml(u.phone ?? '—')}</td>
              <td>
                <select class="role-select" data-user="${u.id}">
                  <option value="USER"       ${u.role === 'USER'       ? 'selected' : ''}>USER</option>
                  <option value="SUPERADMIN" ${u.role === 'SUPERADMIN' ? 'selected' : ''}>SUPERADMIN</option>
                </select>
              </td>
              <td class="admitido-cell">
                <button class="btn btn--xs admitido-toggle-btn ${u.admitido ? 'btn--success' : 'btn--warning'}"
                  data-user="${u.id}" data-admitido="${u.admitido ? 'true' : 'false'}">
                  ${u.admitido ? '✅ Admitido' : '⏳ Pendiente'}
                </button>
              </td>
              <td>${formatDate(u.created_at, { day: '2-digit', month: 'short', year: 'numeric' })}</td>
              <td>
                <button class="btn btn--xs btn--primary save-role-btn" data-user="${u.id}">💾 Guardar rol</button>
                <button class="btn btn--xs btn--danger delete-user-btn" data-user="${u.id}" data-name="${escapeHtml(u.username)}">🗑️</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    // Select all checkbox
    const selectAllCb = container.querySelector('#users-select-all');
    const deleteBtn   = container.querySelector('#delete-selected-btn');

    function updateDeleteBtn() {
      const checked = container.querySelectorAll('.user-select-cb:checked');
      deleteBtn.disabled = checked.length === 0;
      deleteBtn.textContent = checked.length > 0
        ? `🗑️ Borrar seleccionados (${checked.length})`
        : '🗑️ Borrar seleccionados';
    }

    selectAllCb.addEventListener('change', () => {
      container.querySelectorAll('.user-select-cb').forEach(cb => { cb.checked = selectAllCb.checked; });
      updateDeleteBtn();
    });
    container.querySelectorAll('.user-select-cb').forEach(cb => {
      cb.addEventListener('change', () => {
        selectAllCb.checked = [...container.querySelectorAll('.user-select-cb')].every(c => c.checked);
        updateDeleteBtn();
      });
    });

    // Delete selected
    deleteBtn.addEventListener('click', async () => {
      const checked = [...container.querySelectorAll('.user-select-cb:checked')];
      const ids = checked.map(cb => cb.dataset.user);
      if (!confirm(`¿Seguro que quieres borrar ${ids.length} usuario(s)? Esta acción no se puede deshacer.`)) return;
      deleteBtn.disabled = true;
      try {
        await deleteUsers(ids);
        ids.forEach(id => container.querySelector(`#user-row-${id}`)?.remove());
        selectAllCb.checked = false;
        updateDeleteBtn();
        showToast(`${ids.length} usuario(s) eliminado(s)`, 'success');
      } catch (err) {
        showToast('Error al borrar: ' + err.message, 'error');
        deleteBtn.disabled = false;
      }
    });

    // Delete single user
    container.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.user;
        const name   = btn.dataset.name;
        if (!confirm(`¿Seguro que quieres borrar al usuario "${name}"? Esta acción no se puede deshacer.`)) return;
        btn.disabled = true;
        try {
          await deleteUsers([userId]);
          container.querySelector(`#user-row-${userId}`)?.remove();
          updateDeleteBtn();
          showToast(`Usuario "${name}" eliminado`, 'success');
        } catch (err) {
          showToast('Error al borrar: ' + err.message, 'error');
          btn.disabled = false;
        }
      });
    });

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

    container.querySelectorAll('.admitido-toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const userId = btn.dataset.user;
        const current = btn.dataset.admitido === 'true';
        const newValue = !current;
        btn.disabled = true;
        try {
          await updateUserAdmitido(userId, newValue);
          btn.dataset.admitido = newValue ? 'true' : 'false';
          btn.textContent = newValue ? '✅ Admitido' : '⏳ Pendiente';
          btn.className = `btn btn--xs admitido-toggle-btn ${newValue ? 'btn--success' : 'btn--warning'}`;
          showToast(newValue ? 'Usuario admitido' : 'Usuario suspendido', 'success');
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
// RESULTS SUB-PANELS
// ============================================================
async function renderResultsFinalSubpanel(panel) {
  try {
    const result = await getTournamentResult();
    panel.innerHTML = `
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

    bindFlagSelects(panel);

    panel.querySelector('#tournament-result-form').addEventListener('submit', async (e) => {
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
    panel.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

async function renderResultsClassificationSubpanel(panel) {
  try {
    const existingResults = await getGroupPositionResults();
    const resultsByGroup  = Object.fromEntries(existingResults.map(r => [r.group_id, r]));
    const teamsById       = Object.fromEntries(_teams.map(t => [t.id, t]));
    const sortedGroups    = [..._groups].sort((a, b) => a.letter.localeCompare(b.letter));

    function buildGroupCard(group) {
      const teamIds   = group.group_teams.map(gt => gt.team_id);
      const groupTeams = teamIds.map(id => teamsById[id]).filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
      const saved = resultsByGroup[group.id];

      function posSelect(pos, savedTeamId) {
        return buildFlagSelect(`pos_${pos}_team_id`, groupTeams, savedTeamId ?? null);
      }

      return `
        <div class="admin-classif-card">
          <div class="admin-classif-card__title">Grupo ${escapeHtml(group.letter)}</div>
          <form class="admin-classif-form" data-group-id="${group.id}">
            <div class="admin-classif-positions">
              <div class="admin-classif-pos"><span class="admin-classif-pos__label">🥇 1º</span>${posSelect(1, saved?.pos_1_team_id)}</div>
              <div class="admin-classif-pos"><span class="admin-classif-pos__label">🥈 2º</span>${posSelect(2, saved?.pos_2_team_id)}</div>
              <div class="admin-classif-pos"><span class="admin-classif-pos__label">🥉 3º</span>${posSelect(3, saved?.pos_3_team_id)}</div>
              <div class="admin-classif-pos"><span class="admin-classif-pos__label">&nbsp;&nbsp;4º</span>${posSelect(4, saved?.pos_4_team_id)}</div>
            </div>
            <button type="submit" class="btn btn--sm btn--primary" style="margin-top:12px">💾 Guardar Grupo ${escapeHtml(group.letter)}</button>
          </form>
        </div>`;
    }

    panel.innerHTML = `
      <div class="admin-results-header">
        <h2>Clasificación Fase Regular</h2>
        <p style="color:var(--clr-text-muted);font-size:0.85rem;margin:0">Certifica el orden final de cada grupo para calcular las predicciones de clasificación.</p>
      </div>
      <div class="admin-classif-grid">
        ${sortedGroups.map(buildGroupCard).join('')}
      </div>`;

    bindFlagSelects(panel);

    panel.querySelectorAll('.admin-classif-form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const groupId = parseInt(form.dataset.groupId, 10);
        const fd = new FormData(form);
        const positions = [1, 2, 3, 4].map(p => parseInt(fd.get(`pos_${p}_team_id`)) || null);
        const btn = form.querySelector('[type="submit"]');
        const origLabel = btn ? btn.textContent : '';
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; }
        try {
          await upsertGroupPositionResult(groupId, positions);
          const groupLetter = sortedGroups.find(g => g.id === groupId)?.letter ?? groupId;
          showToast(`Clasificación Grupo ${groupLetter} guardada`, 'success');
        } catch (err) {
          showToast('Error: ' + err.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = origLabel; }
        }
      });
    });
  } catch (err) {
    panel.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}
