/**
 * Outils communs : hasard reproductible, dates, calendrier ouvré.
 * Les fonctions qui finissent par "_" sont privées : Apps Script ne les expose ni au menu ni à google.script.run.
 */
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
function rng_(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.normal = () => {
    const u = Math.max(next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
  };
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return next;
}

function startOfDay_(d) {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays_(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

function daysBetween_(a, b) {
  return (b.getTime() - a.getTime()) / DAY_MS;
}

function isWeekend_(d) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

/** Lundi de la semaine de d, à 00:00. */
function mondayOf_(d) {
  const x = startOfDay_(d);
  const w = (x.getDay() + 6) % 7;
  return addDays_(x, -w);
}

/** Semaine ISO, sous la forme "S43". */
function isoWeekLabel_(d) {
  const x = startOfDay_(d);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const firstThursday = new Date(x.getFullYear(), 0, 4);
  const week = 1 + Math.round(((x - firstThursday) / DAY_MS - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return 'S' + String(week).padStart(2, '0');
}

/**
 * Convertit des heures ouvrées écoulées depuis `origin` (un lundi 00:00) en date calendaire.
 * Une journée ouvrée = WORK_HOURS_PER_DAY heures à partir de SHIFT_START_HOUR ; week-ends sautés.
 */
function workHoursToDate_(origin, h) {
  const perDay = CC.WORK_HOURS_PER_DAY;
  let dayIdx = Math.floor(h / perDay);
  const within = h - dayIdx * perDay;
  let d = startOfDay_(origin);
  while (isWeekend_(d)) d = addDays_(d, 1);
  while (dayIdx > 0) {
    d = addDays_(d, 1);
    if (!isWeekend_(d)) dayIdx -= 1;
  }
  return new Date(d.getTime() + (CC.SHIFT_START_HOUR + within) * HOUR_MS);
}

/** Inverse approché de workHoursToDate_ : heures ouvrées entre origin et d. */
function dateToWorkHours_(origin, d) {
  let h = 0;
  let cur = startOfDay_(origin);
  const target = startOfDay_(d);
  while (cur < target) {
    if (!isWeekend_(cur)) h += CC.WORK_HOURS_PER_DAY;
    cur = addDays_(cur, 1);
  }
  if (!isWeekend_(target)) {
    const within = (d.getTime() - target.getTime()) / HOUR_MS - CC.SHIFT_START_HOUR;
    h += Math.min(Math.max(within, 0), CC.WORK_HOURS_PER_DAY);
  }
  return h;
}

function round_(x, n) {
  const k = Math.pow(10, n || 0);
  return Math.round(x * k) / k;
}

function toDate_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate_(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

function fmtDateTime_(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return fmtDate_(d) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** Nombre au format français : virgule décimale, espace fine pour les milliers. */
function fmtNum_(x, n) {
  if (x === null || x === undefined || x === '') return '';
  const v = round_(Number(x), n === undefined ? 1 : n);
  const parts = String(Math.abs(v)).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  return (v < 0 ? '-' : '') + parts.join(',');
}
