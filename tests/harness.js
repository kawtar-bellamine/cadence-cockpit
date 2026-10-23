/**
 * Charge les fichiers .gs dans un contexte Node isolé, avec des doublures des services Google
 * (SpreadsheetApp, HtmlService, PropertiesService, UrlFetchApp, ScriptApp, Utilities, Logger).
 * Les doublures gardent réellement les valeurs des cellules ; les appels de mise en forme sont acceptés et ignorés.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'src');

/** Objet qui accepte n'importe quelle chaîne d'appels (mise en forme, graphiques, menus...). */
function chain(log, name) {
  const target = function () {};
  const p = new Proxy(target, {
    get(_, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      if (prop === 'toString') return () => `[chain ${name}]`;
      return chain(log, `${name}.${String(prop)}`);
    },
    apply(_, __, args) {
      log.push(name);
      return p;
    },
  });
  return p;
}

function colToIndex(letters) {
  return letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
}

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
    return new Proxy(this, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        return (...args) => { sheet.log.push(`range.${String(prop)}`); return t._self; };
      },
    });
  }
  set _self(v) { this.__self = v; }
  get _self() { return this.__self; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i += 1) {
      const r = [];
      for (let j = 0; j < this.nc; j += 1) r.push(this.sheet.get(this.row + i, this.col + j));
      out.push(r);
    }
    return out;
  }
  getDisplayValues() { return this.getValues().map((r) => r.map((v) => (v === null ? '' : String(v)))); }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValues(v) {
    if (v.length !== this.nr || v.some((r) => r.length !== this.nc)) {
      throw new Error(`setValues: dimensions ${v.length}x${v[0] && v[0].length} != ${this.nr}x${this.nc}`);
    }
    v.forEach((r, i) => r.forEach((x, j) => this.sheet.set(this.row + i, this.col + j, x)));
    return this._self;
  }
  setValue(x) { this.sheet.set(this.row, this.col, x); return this._self; }
  setFormula(f) { this.sheet.set(this.row, this.col, f); return this._self; }
  getRow() { return this.row; }
  getColumn() { return this.col; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getA1Notation() { return `R${this.row}C${this.col}:${this.nr}x${this.nc}`; }
  getSheet() { return this.sheet; }
}

function makeRange(sheet, r, c, nr, nc) {
  const fr = new FakeRange(sheet, r, c, nr || 1, nc || 1);
  fr._self = fr;
  return fr;
}

class FakeSheet {
  constructor(ss, name) {
    this.ss = ss; this.name = name; this.cells = new Map(); this.log = ss.log; this.charts = [];
    return new Proxy(this, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop === 'symbol') return undefined;
        return (...args) => { t.log.push(`sheet.${String(prop)}`); return chain(t.log, `sheet.${String(prop)}`); };
      },
    });
  }
  key(r, c) { return `${r},${c}`; }
  get(r, c) { const v = this.cells.get(this.key(r, c)); return v === undefined ? '' : v; }
  set(r, c, v) { if (v === '' || v === null || v === undefined) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), v); }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getLastRow() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[0]); return m; }
  getLastColumn() { let m = 0; for (const k of this.cells.keys()) m = Math.max(m, +k.split(',')[1]); return m; }
  getMaxRows() { return Math.max(1000, this.getLastRow()); }
  getMaxColumns() { return Math.max(26, this.getLastColumn()); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = a.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/);
      if (!m) throw new Error(`A1 non géré: ${a}`);
      const r1 = +m[2]; const c1 = colToIndex(m[1]);
      const r2 = m[4] ? +m[4] : r1; const c2 = m[3] ? colToIndex(m[3]) : c1;
      return makeRange(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    if (a < 1 || b < 1 || (c !== undefined && c < 1) || (d !== undefined && d < 1)) throw new Error(`getRange invalide ${a},${b},${c},${d}`);
    return makeRange(this, a, b, c, d);
  }
  getDataRange() { return makeRange(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  clear() { this.cells.clear(); this.charts = []; return this; }
  clearContents() { this.cells.clear(); return this; }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, j) => this.set(r, j + 1, v)); return this; }
  getCharts() { return this.charts.slice(); }
  removeChart(c) { this.charts = this.charts.filter((x) => x !== c); }
  insertChart(c) { this.charts.push(c); }
  newChart() { return chain(this.log, 'chart'); }
  getConditionalFormatRules() { return []; }
  getBandings() { return []; }
  getParent() { return this.ss; }
}

class FakeSpreadsheet {
  constructor() { this.sheets = []; this.log = []; this.toasts = []; this.name = 'Cadence Cockpit'; }
  getSheetByName(n) { return this.sheets.find((s) => s.getName() === n) || null; }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error(`existe déjà: ${n}`); const s = new FakeSheet(this, n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets.slice(); }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  setActiveSheet(s) { this.active = s; return s; }
  getActiveSheet() { return this.active || this.sheets[0]; }
  moveActiveSheet(pos) { const s = this.getActiveSheet(); this.sheets = this.sheets.filter((x) => x !== s); this.sheets.splice(pos - 1, 0, s); }
  toast(msg) { this.toasts.push(msg); }
  getSpreadsheetTimeZone() { return 'Europe/Paris'; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/fake'; }
  getId() { return 'fake'; }
}

function load(options = {}) {
  const ss = options.spreadsheet || new FakeSpreadsheet();
  const props = new Map(Object.entries(options.properties || {}));
  const fetches = [];
  const log = ss.log;
  const ctx = {
    console, Math, Date, JSON, Object, Array, String, Number, Set, Map, RegExp, Error, isNaN, parseFloat, parseInt, Intl,
    SpreadsheetApp: new Proxy({
      getActive: () => ss, getActiveSpreadsheet: () => ss,
      getUi: () => chain(log, 'ui'),
      flush: () => {},
    }, { get(t, p) { return p in t ? t[p] : chain(log, `SpreadsheetApp.${String(p)}`); } }),
    HtmlService: chain(log, 'HtmlService'),
    Charts: chain(log, 'Charts'),
    ScriptApp: chain(log, 'ScriptApp'),
    Session: { getScriptTimeZone: () => 'Europe/Paris', getActiveUser: () => ({ getEmail: () => 'demo@example.com' }) },
    LockService: { getDocumentLock: () => ({ waitLock: () => {}, releaseLock: () => {} }), getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    Logger: { log: () => {} },
    Utilities: {
      formatDate: (d, tz, f) => d.toISOString(),
      sleep: () => {},
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }),
      getDocumentProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, v) }),
    },
    UrlFetchApp: {
      fetch: (url, params) => {
        fetches.push({ url, params });
        if (!options.fetch) throw new Error('réseau interdit dans les tests');
        const r = options.fetch(url, params);
        return { getResponseCode: () => r.code, getContentText: () => r.body };
      },
    },
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.gs')).sort();
  // En Apps Script, tous les fichiers partagent la même portée globale : on les concatène dans l'ordre.
  const code = files.map((f) => `// ---- ${f}\n${fs.readFileSync(path.join(SRC, f), 'utf8')}`).join('\n');
  vm.runInContext(`${code}\n;globalThis.__exports = { ${exportedNames(code).join(', ')} };`, ctx, { filename: 'apps-script-bundle.js' });
  return { g: ctx.__exports, ctx, ss, props, fetches };
}

function exportedNames(code) {
  const names = new Set();
  for (const m of code.matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^const\s+([A-Za-z0-9_$]+)\s*=/gm)) names.add(m[1]);
  return [...names];
}

module.exports = { load, FakeSpreadsheet };
