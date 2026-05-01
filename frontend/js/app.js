// =============================================================
// app.js — Main entry point & router
// =============================================================
import { supabase } from './config.js';
import { getSession, getCurrentUser, getProfile, logout, onAuthChange,
         bindLoginForm, bindRegisterForm, bindForgotForm } from './auth.js';
import { showToast, requireAuth, redirectIfAuth, escapeHtml, initials } from './utils.js';
import { initPredictions } from './predictions.js';
import { initRanking, initStats } from './ranking.js';
import { initCompare } from './compare.js';
import { getMatches, getStandings, getGroups, subscribeToMatchResults } from './api.js';
import { formatDate, roundLabel, groupBy, fmtPts, flagImg } from './utils.js';

const PAGE = document.body.dataset.page; // set via data-page attribute on <body>

// ============================================================
// Startup
// ============================================================
(async () => {
  const session = await getSession();

  switch (PAGE) {
    case 'login':
      initLoginPage(session);
      break;
    case 'dashboard':
      await initDashboardPage(session);
      break;
    case 'admin':
      await initAdminPage(session);
      break;
  }
})();

// ============================================================
// LOGIN PAGE
// ============================================================
function initLoginPage(session) {
  if (!redirectIfAuth(session)) return;

  // Tabs: login / register / forgot
  document.querySelectorAll('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.auth-form-panel').forEach(p => p.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`)?.classList.remove('hidden');
    });
  });

  bindLoginForm('login-form', () => window.location.replace('dashboard.html'));
  bindRegisterForm('register-form', () => window.location.replace('dashboard.html'));
  bindForgotForm('forgot-form');

  onAuthChange((s) => {
    if (s) window.location.replace('dashboard.html');
  });
}

// ============================================================
// DASHBOARD PAGE
// ============================================================
async function initDashboardPage(session) {
  if (!requireAuth(session)) return;

  const user    = session.user;
  const profile = await getProfile(user.id);

  // Populate header
  setUserHeader(profile ?? { username: user.email.split('@')[0] });

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout();
  });

  // Admin link (only for SUPERADMIN)
  if (profile?.role === 'SUPERADMIN') {
    document.getElementById('admin-link')?.classList.remove('hidden');
  }

  // Main tabs
  const tabs = {
    partidos:      () => initMatchesTab(user),
    predicciones:  () => initPredictions(user),
    clasificacion: () => initRanking(user),
    estadisticas:  () => initStats(user),
    comparar:      () => initCompare(user),
    perfil:        () => initProfileTab(profile, user),
  };

  document.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => activateDashTab(tab, tabs));
  });

  // User icon / name → open profile panel
  document.getElementById('user-profile-btn')?.addEventListener('click', () => {
    const perfilTab = document.querySelector('.dash-tab[data-tab="perfil"]');
    if (perfilTab) activateDashTab(perfilTab, tabs);
  });

  // Default tab
  const defaultTab = document.querySelector('.dash-tab[data-tab="partidos"]');
  if (defaultTab) activateDashTab(defaultTab, tabs);

  // Realtime: refresh active panel when results change
  subscribeToMatchResults(async () => {
    const activePanel = document.querySelector('.dash-panel:not(.hidden)');
    if (!activePanel) return;
    if (activePanel.id === 'panel-partidos')      await initMatchesTab(user);
    if (activePanel.id === 'panel-predicciones')  await initPredictions(user);
    if (activePanel.id === 'panel-estadisticas')  await initStats(user);
  });
}

function activateDashTab(selectedTab, tabHandlers) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.dash-panel').forEach(p => p.classList.add('hidden'));
  selectedTab.classList.add('active');
  const key = selectedTab.dataset.tab;
  const panel = document.getElementById(`panel-${key}`);
  if (panel) {
    panel.classList.remove('hidden');
    tabHandlers[key]?.();
  }
}

function setUserHeader(profile) {
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = profile.username;
}

// ---- Matches Overview Tab ----------------------------------
async function initMatchesTab(user) {
  const container = document.getElementById('panel-partidos');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando partidos…</div>';
  try {
    const [matches, groups] = await Promise.all([getMatches(), getGroups()]);
    // Sort all matches by datetime ascending upfront
    matches.sort((a, b) => new Date(a.match_datetime ?? 0) - new Date(b.match_datetime ?? 0));
    const byRound = groupBy(matches, 'round');
    const roundOrder = ['group', 'octavos', 'cuartos', 'semis', 'tercero', 'final'];
    let html = '';

    for (const round of roundOrder) {
      const roundMatches = byRound[round] ?? [];
      if (!roundMatches.length) continue;

      html += `<h3 class="round-heading">${escapeHtml(roundLabel(round))}</h3>`;

      if (round === 'group') {
        // Render group-by-group (already sorted by datetime from above)
        const byGroup = groupBy(roundMatches, 'group_id');
        for (const g of groups) {
          const gMatches = byGroup[g.id] ?? [];
          html += `<div class="group-section">
            <h4 class="group-heading">Grupo ${escapeHtml(g.letter)}</h4>
            <div class="matches-list">`;
          for (const m of gMatches) {
            html += buildMatchRow(m);
          }
          html += '</div></div>';
        }
      } else {
        html += '<div class="matches-list">';
        for (const m of roundMatches) html += buildMatchRow(m);
        html += '</div>';
      }
    }

    container.innerHTML = html || '<div class="empty">No hay partidos cargados</div>';
  } catch (err) {
    container.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

function buildMatchRow(m) {
  const res = m.match_results ?? null;
  const homeFlag = m.home_team ? flagImg(m.home_team) : '';
  const awayFlag = m.away_team ? flagImg(m.away_team) : '';
  const homeName = m.home_team ? escapeHtml(m.home_team.name) : 'TBD';
  const awayName = m.away_team ? escapeHtml(m.away_team.name) : 'TBD';
  const score = res ? `${res.home_score} – ${res.away_score}` : 'vs';
  const statusClass = m.status === 'finished' ? 'match-row--done' : m.status === 'live' ? 'match-row--live' : '';

  return `
    <div class="match-row ${statusClass}">
      <span class="match-row__date">${formatDate(m.match_datetime)}</span>
      <span class="match-row__home">${homeFlag} ${homeName}</span>
      <span class="match-row__score">${escapeHtml(score)}</span>
      <span class="match-row__away">${awayName} ${awayFlag}</span>
      ${m.status === 'live' ? '<span class="live-badge">EN VIVO</span>' : ''}
    </div>`;
}

// ---- Profile Tab -------------------------------------------
async function initProfileTab(profile, user) {
  const container = document.getElementById('panel-perfil');
  if (!container || !profile) return;

  container.innerHTML = `
    <div class="profile-cols">
      <div class="profile-col">
        <h3 class="profile-col__title">👤 Mi Perfil</h3>
        <form id="profile-form" class="profile-form">
          <div class="form-group">
            <label>Nombre de usuario</label>
            <input type="text" name="username" value="${escapeHtml(profile.username)}" minlength="3" maxlength="30" required>
          </div>
          <div class="form-group">
            <label>Email</label>
            <input type="email" value="${escapeHtml(profile.email)}" disabled>
          </div>
          <div class="form-group">
            <label>Teléfono</label>
            <input type="tel" name="phone" value="${escapeHtml(profile.phone ?? '')}">
          </div>
          <button type="submit" class="btn btn--primary">💾 Actualizar perfil</button>
        </form>
      </div>
      <div class="profile-col">
        <h3 class="profile-col__title">🔑 Cambiar contraseña</h3>
        <form id="password-form" class="profile-form">
          <div class="form-group">
            <label>Nueva contraseña</label>
            <input type="password" name="new_password" minlength="6" required>
          </div>
          <div class="form-group">
            <label>Confirmar contraseña</label>
            <input type="password" name="confirm_password" minlength="6" required>
          </div>
          <button type="submit" class="btn btn--outline">🔑 Cambiar contraseña</button>
        </form>
      </div>
    </div>`;

  // Profile update
  container.querySelector('#profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type="submit"]');
    const fd  = new FormData(e.target);
    if (btn) { btn.disabled = true; }
    try {
      const { updateProfile } = await import('./auth.js');
      await updateProfile(user.id, {
        username: fd.get('username').trim(),
        phone:    fd.get('phone').trim(),
      });
      showToast('✅ Perfil actualizado', 'success');
      setUserHeader({ username: fd.get('username').trim() });
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; }
    }
  });

  // Password change
  container.querySelector('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd  = new FormData(e.target);
    const pwd = fd.get('new_password');
    const cfm = fd.get('confirm_password');
    if (pwd !== cfm) { showToast('Las contraseñas no coinciden', 'warning'); return; }
    const btn = e.target.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; }
    try {
      const { updatePassword } = await import('./auth.js');
      await updatePassword(pwd);
      showToast('✅ Contraseña actualizada', 'success');
      e.target.reset();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; }
    }
  });
}

// ============================================================
// ADMIN PAGE
// ============================================================
async function initAdminPage(session) {
  if (!requireAuth(session)) return;

  const profile = await getProfile(session.user.id);
  if (profile?.role !== 'SUPERADMIN') {
    showToast('Acceso denegado: se requiere SUPERADMIN', 'error');
    setTimeout(() => window.location.replace('dashboard.html'), 2000);
    return;
  }

  setUserHeader(profile);
  document.getElementById('logout-btn')?.addEventListener('click', logout);

  const { initAdmin } = await import('./admin.js');
  await initAdmin();
}
