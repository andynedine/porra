// =============================================================
// ranking.js — Ranking, statistics, and charts
// =============================================================
import {
  getGlobalRanking, getRoundRanking, getMyScore,
  getMyAchievements, getAllAchievements, subscribeToScores, unsubscribeFromScores,
  getMyPointsBreakdown,
} from './api.js';
import { escapeHtml, fmtPts, initials, roundLabel } from './utils.js';
import { ROUNDS } from './config.js';

let _chartInstance = null;
let _currentUser   = null;

// ============================================================
// GLOBAL RANKING
// ============================================================
export async function initRanking(user) {
  _currentUser = user;
  const el = document.getElementById('ranking-section');
  if (!el) return;

  el.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando clasificación…</div>';

  try {
    await renderRanking(el);
    // Subscribe to realtime score updates (removes any previous channel first)
    subscribeToScores(() => renderRanking(el));
  } catch (err) {
    el.innerHTML = `<div class="error">Error al cargar ranking: ${escapeHtml(err.message)}</div>`;
  }
}

export function cleanupRanking() {
  unsubscribeFromScores();
}

async function renderRanking(container) {
  const [ranking] = await Promise.all([getGlobalRanking()]);

  const myRank = ranking.find(r => r.user_id === _currentUser.id);

  let html = `
    <div class="ranking-header">
      <h2 class="section-title">🏆 Clasificación Global</h2>
      <div class="round-filter">
        <label for="round-select">Ver por ronda:</label>
        <select id="round-select">
          <option value="global">Global</option>
          ${Object.entries(ROUNDS).map(([k,v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join('')}
        </select>
      </div>
    </div>`;

  if (myRank) {
    html += `
      <div class="my-rank-banner">
        <span class="my-rank-pos">#${myRank.rank}</span>
        <span class="my-rank-pts">${fmtPts(myRank.total_points)} pts</span>
        <span class="my-rank-exact">${myRank.exact_count} exactos</span>
        <span class="my-rank-acc">${fmtPts(myRank.accuracy_pct)}% acierto</span>
      </div>`;
  }

  html += '<div id="ranking-table-wrapper">' + buildRankingTable(ranking, _currentUser.id) + '</div>';
  container.innerHTML = html;

  // Round selector
  container.querySelector('#round-select').addEventListener('change', async (e) => {
    const val = e.target.value;
    const wrapper = container.querySelector('#ranking-table-wrapper');
    wrapper.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
    try {
      if (val === 'global') {
        const r = await getGlobalRanking();
        wrapper.innerHTML = buildRankingTable(r, _currentUser.id);
      } else {
        const r = await getRoundRanking(val);
        wrapper.innerHTML = buildRoundRankingTable(r, _currentUser.id);
      }
    } catch (err) {
      wrapper.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
    }
  });
}

function buildRankingTable(ranking, myId) {
  if (!ranking?.length) return '<div class="empty">Sin datos aún</div>';
  return `
    <table class="ranking-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Jugador</th>
          <th>Pts</th>
          <th>Exactos</th>
          <th>Parciales</th>
          <th>Fallos</th>
          <th>% Acierto</th>
        </tr>
      </thead>
      <tbody>
        ${ranking.map(r => `
          <tr class="${r.user_id === myId ? 'row--me' : ''}">
            <td>${medalIcon(r.rank)}</td>
            <td class="td-player">
              <div class="avatar avatar--sm">${r.avatar_url
                ? `<img src="${escapeHtml(r.avatar_url)}" alt="">`
                : `<span>${initials(r.username)}</span>`}</div>
              <span>${escapeHtml(r.username)}</span>
            </td>
            <td class="td-pts"><strong>${fmtPts(r.total_points)}</strong></td>
            <td class="td-exact">${r.exact_count}</td>
            <td>${r.partial_count}</td>
            <td>${r.wrong_count}</td>
            <td>${fmtPts(r.accuracy_pct)}%</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildRoundRankingTable(ranking, myId) {
  if (!ranking?.length) return '<div class="empty">Sin datos para esta ronda</div>';
  return `
    <table class="ranking-table">
      <thead>
        <tr><th>#</th><th>Jugador</th><th>Pts Ronda</th><th>Exactos</th><th>Parciales</th></tr>
      </thead>
      <tbody>
        ${ranking.map(r => `
          <tr class="${r.user_id === myId ? 'row--me' : ''}">
            <td>${medalIcon(r.rank)}</td>
            <td class="td-player">
              <div class="avatar avatar--sm">${r.avatar_url
                ? `<img src="${escapeHtml(r.avatar_url)}" alt="">`
                : `<span>${initials(r.username)}</span>`}</div>
              <span>${escapeHtml(r.username)}</span>
            </td>
            <td><strong>${fmtPts(r.round_points)}</strong></td>
            <td>${r.exact_count}</td>
            <td>${r.partial_count}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function medalIcon(rank) {
  if (rank === 1) return '🥇';
  if (rank === 2) return '🥈';
  if (rank === 3) return '🥉';
  return rank;
}

// ============================================================
// MY STATISTICS
// ============================================================
export async function initStats(user) {
  _currentUser = user;
  const el = document.getElementById('stats-section');
  if (!el) return;

  el.innerHTML = '<div class="loading"><span class="spinner"></span> Cargando estadísticas…</div>';

  try {
    const [score, achievements, allAchievements, breakdown] = await Promise.all([
      getMyScore(user.id),
      getMyAchievements(user.id),
      getAllAchievements(),
      getMyPointsBreakdown(user.id),
    ]);
    renderStats(el, score, achievements, allAchievements, breakdown);
  } catch (err) {
    el.innerHTML = `<div class="error">${escapeHtml(err.message)}</div>`;
  }
}

function renderStats(container, score, myAchievements, allAchievements, breakdown) {
  const s = score ?? {};
  const earnedIds = new Set(myAchievements.map(a => a.achievement_id));

  container.innerHTML = `
    <h2 class="section-title">📊 Mis Estadísticas</h2>

    <div class="stats-cards">
      <div class="stat-card stat-card--gold">
        <div class="stat-card__value">${fmtPts(s.total_points ?? 0)}</div>
        <div class="stat-card__label">Puntos totales</div>
      </div>
      <div class="stat-card stat-card--green">
        <div class="stat-card__value">${s.exact_count ?? 0}</div>
        <div class="stat-card__label">Exactos</div>
      </div>
      <div class="stat-card stat-card--blue">
        <div class="stat-card__value">${s.partial_count ?? 0}</div>
        <div class="stat-card__label">Resultados</div>
      </div>
      <div class="stat-card stat-card--red">
        <div class="stat-card__value">${s.wrong_count ?? 0}</div>
        <div class="stat-card__label">Fallos</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${fmtPts(s.accuracy_pct ?? 0)}%</div>
        <div class="stat-card__label">% Acierto</div>
      </div>
      <div class="stat-card">
        <div class="stat-card__value">${s.total_predicted ?? 0}</div>
        <div class="stat-card__label">Predicciones hechas</div>
      </div>
    </div>

    <div class="chart-wrapper">
      <canvas id="stats-donut" width="300" height="300" aria-label="Distribución de aciertos"></canvas>
    </div>

    ${buildBreakdownTable(breakdown)}

    <h3 class="section-title">🏅 Logros</h3>
    <div class="achievements-grid">
      ${allAchievements.map(a => `
        <div class="achievement-card ${earnedIds.has(a.id) ? 'achievement-card--earned' : 'achievement-card--locked'}">
          <div class="achievement-card__icon">${escapeHtml(a.icon)}</div>
          <div class="achievement-card__name">${escapeHtml(a.name)}</div>
          <div class="achievement-card__desc">${escapeHtml(a.description ?? '')}</div>
          ${earnedIds.has(a.id) ? '<div class="achievement-card__earned">✅ Conseguido</div>'
            : (a.threshold ? `<div class="achievement-card__progress">${s.exact_count ?? 0}/${a.threshold} exactos</div>` : '')}
        </div>`).join('')}
    </div>`;

  // Draw donut chart with Chart.js (loaded globally from CDN)
  if (window.Chart) {
    drawDonutChart(s.exact_count ?? 0, s.partial_count ?? 0, s.wrong_count ?? 0);
  }
}

function buildBreakdownTable(breakdown) {
  if (!breakdown) return '';

  const roundOrder = ['group', 'dieciseisavos', 'octavos', 'cuartos', 'semis', 'tercero', 'final'];
  const roundLabels = {
    group:         'Fase de Grupos',
    dieciseisavos: 'Dieciseisavos',
    octavos:       'Octavos',
    cuartos:       'Cuartos',
    semis:         'Semifinales',
    tercero:       'Tercer y 4º Puesto',
    final:         'Gran Final',
  };

  const rows = [];

  // Match points per round
  for (const round of roundOrder) {
    const pts = breakdown.byRound[round];
    if (pts === undefined) continue;
    rows.push({ label: roundLabels[round] ?? round, pts, category: 'match' });
  }

  // Group position bonus
  if (breakdown.groupPositionPts > 0 || breakdown.groupPositionPts === 0) {
    rows.push({ label: 'Posición en grupos', pts: breakdown.groupPositionPts, category: 'bonus' });
  }

  // Tournament bonus
  const t = breakdown.tournament;
  if (t) {
    const champPts   = (t.champion_points   ?? 0);
    const fin1Pts    = (t.finalist_1_points ?? 0);
    const fin2Pts    = (t.finalist_2_points ?? 0);
    const scorerPts  = (t.top_scorer_points ?? 0);
    const totalBonus = champPts + fin1Pts + fin2Pts + scorerPts;

    if (champPts  > 0) rows.push({ label: 'Torneo — Campeón acertado',           pts: champPts,  category: 'tournament' });
    if (fin1Pts   > 0) rows.push({ label: 'Torneo — Finalista A en la final',     pts: fin1Pts,   category: 'tournament' });
    if (fin2Pts   > 0) rows.push({ label: 'Torneo — Finalista B en la final',     pts: fin2Pts,   category: 'tournament' });
    if (scorerPts > 0) rows.push({ label: 'Torneo — Máximo goleador acertado',    pts: scorerPts, category: 'tournament' });
    if (totalBonus === 0 && t) {
      rows.push({ label: 'Torneo (bonus pendiente / sin aciertos)', pts: 0, category: 'tournament' });
    }
  }

  if (!rows.length) return '';

  const total = rows.reduce((acc, r) => acc + r.pts, 0);

  const categoryIcon = { match: '⚽', bonus: '📋', tournament: '🏆' };

  return `
    <h3 class="section-title">📈 Desglose de Puntos</h3>
    <table class="breakdown-table">
      <thead>
        <tr><th>Concepto</th><th class="breakdown-pts">Puntos</th></tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr class="breakdown-row breakdown-row--${r.category}">
            <td>${categoryIcon[r.category] ?? ''} ${escapeHtml(r.label)}</td>
            <td class="breakdown-pts ${r.pts > 0 ? 'breakdown-pts--pos' : ''}">${fmtPts(r.pts)}</td>
          </tr>`).join('')}
      </tbody>
      <tfoot>
        <tr class="breakdown-total">
          <td><strong>TOTAL</strong></td>
          <td class="breakdown-pts"><strong>${fmtPts(total)}</strong></td>
        </tr>
      </tfoot>
    </table>`;
}

function drawDonutChart(exact, partial, wrong) {
  const canvas = document.getElementById('stats-donut');
  if (!canvas) return;
  if (_chartInstance) { _chartInstance.destroy(); _chartInstance = null; }

  _chartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: ['Exactos', 'Resultado correcto', 'Fallos'],
      datasets: [{
        data: [exact, partial, wrong],
        backgroundColor: ['#00c851', '#ffd700', '#e94560'],
        borderColor: '#1a1a2e',
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#e0e0e0', font: { size: 13 } },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} (${ctx.raw + exact + partial + wrong > 0
              ? Math.round(ctx.raw / (exact + partial + wrong) * 100) : 0}%)`,
          },
        },
      },
      cutout: '65%',
    },
  });
}

// ============================================================
// EVOLUTION CHART (line chart per round)
// ============================================================
export function drawEvolutionChart(canvasId, roundData) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (_chartInstance) { _chartInstance.destroy(); }

  _chartInstance = new window.Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels: roundData.map(r => r.label),
      datasets: roundData.map((r, idx) => ({
        label: r.username,
        data: r.cumPoints,
        borderColor: `hsl(${idx * 47}, 70%, 60%)`,
        backgroundColor: `hsla(${idx * 47}, 70%, 60%, 0.1)`,
        tension: 0.3,
        fill: false,
        pointRadius: 4,
      })),
    },
    options: {
      responsive: true,
      scales: {
        y: { ticks: { color: '#c0c0c0' }, grid: { color: '#333' } },
        x: { ticks: { color: '#c0c0c0' }, grid: { color: '#333' } },
      },
      plugins: {
        legend: { labels: { color: '#e0e0e0', font: { size: 12 } } },
      },
    },
  });
}
