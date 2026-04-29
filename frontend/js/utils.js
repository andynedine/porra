// =============================================================
// utils.js — Shared utility functions
// =============================================================

import { ROUNDS, SCORING } from './config.js';

// ---- Flag icons (flag-icons library, CDN in HTML) ----------
const FLAG_CODE_MAP = {
  MEX:'mx', RSA:'za', KOR:'kr', CZE:'cz',
  CAN:'ca', BIH:'ba', QAT:'qa', SUI:'ch',
  BRA:'br', MAR:'ma', HAI:'ht', SCO:'gb-sct',
  USA:'us', PAR:'py', AUS:'au', TUR:'tr',
  GER:'de', CUW:'cw', CIV:'ci', ECU:'ec',
  NED:'nl', JPN:'jp', SWE:'se', TUN:'tn',
  BEL:'be', EGY:'eg', IRN:'ir', NZL:'nz',
  ESP:'es', CPV:'cv', KSA:'sa', URU:'uy',
  FRA:'fr', SEN:'sn', NOR:'no', IRQ:'iq',
  ARG:'ar', ALG:'dz', AUT:'at', JOR:'jo',
  POR:'pt', COD:'cd', UZB:'uz', COL:'co',
  ENG:'gb-eng', CRO:'hr', GHA:'gh', PAN:'pa',
};

/**
 * Returns an <img>-based flag for a team object { code, name }.
 * Falls back to a neutral icon if the code is unknown.
 */
export function flagImg(team) {
  if (!team?.code) return '<span class="fi fi-xx fis team-flag" title="?"></span>';
  const iso = FLAG_CODE_MAP[team.code.toUpperCase()] ?? team.code.toLowerCase().slice(0, 2);
  return `<span class="fi fi-${iso} fis team-flag" title="${escapeHtml(team.name ?? '')}"></span>`;
}

/** Format a date string or Date object for display (Spanish locale) */
export function formatDate(dt, opts = {}) {
  if (!dt) return '—';
  const d = new Date(dt);
  const defaults = { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' };
  return d.toLocaleDateString('es-ES', { ...defaults, ...opts });
}

/** Returns true if the given ISO string deadline has already passed */
export function deadlinePassed(deadlineISO) {
  if (!deadlineISO) return false;
  return new Date(deadlineISO) < new Date();
}

/** Get human-readable round label */
export function roundLabel(round) {
  return ROUNDS[round]?.label ?? round;
}

/** Preview scoring tooltip text for a round */
export function scoringTooltip(round) {
  const s = SCORING[round];
  if (!s) return '';
  return `Exacto: +${s.exact} pts | Resultado: +${s.partial} pts`;
}

/** Preview points client-side (same logic as SQL function) */
export function previewPoints(round, homePred, awayPred, homeActual, awayActual) {
  if (homePred < 0 || awayPred < 0) return 0;
  if (homeActual === null || homeActual === undefined) return null; // not played yet
  const s = SCORING[round] ?? SCORING.group;
  const predDir   = homePred   > awayPred   ? 'H' : homePred   < awayPred   ? 'A' : 'D';
  const actualDir = homeActual > awayActual ? 'H' : homeActual < awayActual ? 'A' : 'D';
  if (homePred === homeActual && awayPred === awayActual) return s.exact;
  if (predDir === actualDir) return s.partial;
  return 0;
}

/** Show a toast notification */
export function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container') ?? createToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `
    <span class="toast__icon">${{ success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' }[type] ?? 'ℹ️'}</span>
    <span class="toast__msg">${escapeHtml(message)}</span>
  `;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('toast--visible'));
  setTimeout(() => {
    toast.classList.remove('toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, duration);
}

function createToastContainer() {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
  return el;
}

/** Escape HTML to prevent XSS in dynamic content */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/** Debounce: wrap fn so it only fires after `delay` ms of inactivity */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/** Format decimal points for display (e.g., 2.5 → "2.5", 2.0 → "2") */
export function fmtPts(pts) {
  const n = parseFloat(pts ?? 0);
  return n % 1 === 0 ? n.toFixed(0) : n.toFixed(1);
}

/** Return CSS class based on prediction result */
export function resultClass(isExact, isPartial, calculated) {
  if (!calculated) return '';
  if (isExact)   return 'result--exact';
  if (isPartial) return 'result--partial';
  return 'result--miss';
}

/** Get initials from username for avatar fallback */
export function initials(username) {
  if (!username) return '?';
  return username.slice(0, 2).toUpperCase();
}

/** Validate a score input (0–99) */
export function validateScore(value) {
  const n = parseInt(value, 10);
  return !isNaN(n) && n >= 0 && n <= 99;
}

/** Redirect to login if not authenticated */
export function requireAuth(session) {
  if (!session) {
    window.location.replace('index.html');
    return false;
  }
  return true;
}

/** Redirect away from login if already authenticated */
export function redirectIfAuth(session) {
  if (session) {
    window.location.replace('dashboard.html');
    return false;
  }
  return true;
}

/** Spin button and disable during async operations */
export function setButtonLoading(btn, loading, originalText) {
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner"></span>'
    : escapeHtml(originalText);
}

/** Group an array of objects by a key */
export function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key];
    (acc[k] = acc[k] ?? []).push(item);
    return acc;
  }, {});
}

/** Sort standings array */
export function sortStandings(teams) {
  return [...teams].sort((a, b) =>
    b.points - a.points ||
    (b.goals_for - b.goals_against) - (a.goals_for - a.goals_against) ||
    b.goals_for - a.goals_for
  );
}

/** Pluralize an integer count with Spanish noun */
export function pluralEs(n, singular, plural) {
  return `${n} ${n === 1 ? singular : plural}`;
}
