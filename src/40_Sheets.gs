/**
 * Lecture et écriture des onglets Google Sheets, avec leur mise en forme.
 * Règle de performance Apps Script : une seule lecture (getValues) et une seule écriture (setValues) par tableau.
 */

const THEME_ = Object.freeze({
  INK: '#0b0b0b', MUTED: '#52514e', HEADER_BG: '#0d366b', HEADER_INK: '#ffffff', BAND: '#f4f7fb', LINE: '#e1e0d9',
  GOOD_BG: '#e3f4e3', GOOD_INK: '#0a6b0a', WARN_BG: '#fff3d6', WARN_INK: '#7a5200', CRIT_BG: '#fbe3e3', CRIT_INK: '#a32626',
  ACCENT: '#2a78d6', FONT: 'Roboto',
});

/** Colonnes de chaque onglet source : libellé affiché et clé utilisée par la logique. */
const SPECS_ = Object.freeze({
  MOVES: [['Lot', 'lot'], ['Poste', 'poste'], ['Entrée', 'entree', 'date'], ['Début', 'debut', 'date'], ['Sortie', 'sortie', 'date']],
  PLAN: [['Lot', 'lot'], ['Lancement', 'lancement', 'date'], ['Livraison prévue', 'livraisonPrevue', 'date']],
  ALEAS: [['ID', 'id'], ['Date', 'date', 'date'], ['Poste', 'poste'], ['Lot', 'lot'], ['Catégorie', 'categorie'],
    ['Description', 'description'], ['Arrêt (min)', 'arretMin', 'number'], ['Action palliative', 'palliative'],
    ['Action durable', 'durable'], ['Responsable', 'responsable'], ['Échéance', 'echeance', 'date'], ['Statut', 'statut']],
  METRO: [['ID', 'id'], ['Désignation', 'designation'], ['Type', 'type'], ['Poste', 'poste'],
    ['Dernier étalonnage', 'dernierEtalonnage', 'date'], ['Périodicité (j)', 'periodiciteJ', 'number'],
    ['Périodicité de référence (j)', 'periodiciteRefJ', 'number'], ['Historique (C / NC)', 'historique']],
  FIVE_S: [['Semaine du', 'semaine', 'date'], ['Poste', 'poste'], ['Débarrasser', 's1', 'number'], ['Ranger', 's2', 'number'],
    ['Nettoyer', 's3', 'number'], ['Standardiser', 's4', 'number'], ['Maintenir', 's5', 'number'], ['Auditeur', 'auditeur']],
});

const METRO_COMPUTED_ = ['Prochaine échéance', 'Jours restants', 'Statut', 'Périodicité proposée (j)', 'Motif'];

function ss_() {
  return SpreadsheetApp.getActive();
}

function sheet_(name, create) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh && create) sh = ss.insertSheet(name);
  return sh;
}

// ------------------------------------------------------------------ lecture

function readTable_(name, spec) {
  const sh = sheet_(name, false);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getValues();
  const header = values[0].map((h) => String(h).trim());
  const idx = spec.map(([label]) => header.indexOf(label));
  const missing = spec.filter((_, i) => idx[i] < 0).map(([label]) => label);
  if (missing.length) throw new Error('Onglet « ' + name + ' » : colonne(s) manquante(s) : ' + missing.join(', '));
  return values.slice(1).filter((r) => String(r[idx[0]]).trim() !== '').map((r) => {
    const o = {};
    spec.forEach(([, key, type], i) => {
      const v = r[idx[i]];
      o[key] = type === 'date' ? toDate_(v) : type === 'number' ? (v === '' ? null : Number(v)) : String(v).trim();
    });
    return o;
  });
}

function readAll_() {
  const S = CC.SHEETS;
  return {
    moves: readTable_(S.MOVES, SPECS_.MOVES),
    plan: readTable_(S.PLAN, SPECS_.PLAN),
    aleas: readTable_(S.ALEAS, SPECS_.ALEAS),
    instruments: readTable_(S.METRO, SPECS_.METRO),
    audits: readTable_(S.FIVE_S, SPECS_.FIVE_S),
  };
}

// ------------------------------------------------------------------ écriture

/** Écrit un tableau complet (en-tête + lignes) et applique la mise en forme commune. */
function writeTable_(name, headers, rows, opts) {
  const o = opts || {};
  const sh = sheet_(name, true);
  sh.clear();
  sh.getBandings().forEach((b) => b.remove());
  const data = [headers].concat(rows);
  sh.getRange(1, 1, data.length, headers.length).setValues(data);
  styleHeader_(sh, headers.length);
  if (rows.length) {
    const body = sh.getRange(2, 1, rows.length, headers.length);
    body.setFontFamily(THEME_.FONT).setFontSize(10).setFontColor(THEME_.INK).setVerticalAlignment('middle');
    sh.getRange(1, 1, rows.length + 1, headers.length)
      .applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
      .setHeaderRowColor(THEME_.HEADER_BG).setFirstRowColor('#ffffff').setSecondRowColor(THEME_.BAND);
  }
  (o.dateCols || []).forEach((c) => {
    if (rows.length) sh.getRange(2, c, rows.length, 1).setNumberFormat(o.dateFormat || 'dd/mm/yyyy hh:mm');
  });
  (o.widths || []).forEach((w, i) => { if (w) sh.setColumnWidth(i + 1, w); });
  sh.setFrozenRows(1);
  return sh;
}

function styleHeader_(sh, n) {
  sh.getRange(1, 1, 1, n).setBackground(THEME_.HEADER_BG).setFontColor(THEME_.HEADER_INK).setFontWeight('bold')
    .setFontFamily(THEME_.FONT).setFontSize(10).setVerticalAlignment('middle').setWrap(true);
  sh.setRowHeight(1, 34);
}

/** Couleurs de statut par mise en forme conditionnelle (le texte reste lisible sans la couleur). */
function statusRules_(sh, col, nRows, map) {
  const range = sh.getRange(2, col, Math.max(nRows, 1), 1);
  const rules = Object.keys(map).map((text) => {
    const [bg, ink] = map[text];
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(text).setBackground(bg).setFontColor(ink)
      .setBold(true).setRanges([range]).build();
  });
  sh.setConditionalFormatRules(sh.getConditionalFormatRules().concat(rules));
}

function dropdown_(sh, col, values, nRows) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  sh.getRange(2, col, nRows || 999, 1).setDataValidation(rule);
}

function rowsFrom_(objs, spec) {
  return objs.map((o) => spec.map(([, key]) => (o[key] === null || o[key] === undefined ? '' : o[key])));
}

/** Écrit les cinq onglets sources (utilisé par la démonstration). */
function writeSources_(d) {
  const S = CC.SHEETS;
  const T = THEME_;
  writeTable_(S.MOVES, SPECS_.MOVES.map((s) => s[0]), rowsFrom_(d.moves, SPECS_.MOVES),
    { dateCols: [3, 4, 5], widths: [90, 70, 140, 140, 140] });
  writeTable_(S.PLAN, SPECS_.PLAN.map((s) => s[0]), rowsFrom_(d.plan, SPECS_.PLAN),
    { dateCols: [2, 3], widths: [90, 140, 150] });

  const al = writeTable_(S.ALEAS, SPECS_.ALEAS.map((s) => s[0]), rowsFrom_(d.aleas, SPECS_.ALEAS),
    { dateCols: [2], widths: [80, 130, 60, 80, 130, 330, 90, 260, 280, 140, 100, 90] });
  if (d.aleas.length) al.getRange(2, 11, d.aleas.length, 1).setNumberFormat('dd/mm/yyyy');
  al.getRange(2, 6, Math.max(d.aleas.length, 1), 4).setWrap(true);
  dropdown_(al, 3, CC.LINE.map((p) => p.code));
  dropdown_(al, 5, CC.ALEA_CATEGORIES.slice());
  dropdown_(al, 12, CC.ALEA_STATUSES.slice());
  statusRules_(al, 12, 999, { 'Ouvert': [T.CRIT_BG, T.CRIT_INK], 'En cours': [T.WARN_BG, T.WARN_INK], 'Clos': [T.GOOD_BG, T.GOOD_INK] });

  const me = writeTable_(S.METRO, SPECS_.METRO.map((s) => s[0]).concat(METRO_COMPUTED_), rowsFrom_(d.instruments, SPECS_.METRO)
    .map((r) => r.concat(['', '', '', '', ''])), { widths: [90, 230, 130, 60, 120, 90, 110, 120, 120, 90, 100, 120, 330] });
  if (d.instruments.length) me.getRange(2, 5, d.instruments.length, 1).setNumberFormat('dd/mm/yyyy');
  dropdown_(me, 4, CC.LINE.map((p) => p.code));

  const fs = writeTable_(S.FIVE_S, SPECS_.FIVE_S.map((s) => s[0]).concat(['Score (%)']),
    rowsFrom_(d.audits, SPECS_.FIVE_S).map((r) => r.concat([''])), { widths: [100, 60, 95, 80, 80, 100, 90, 130, 80] });
  if (d.audits.length) fs.getRange(2, 1, d.audits.length, 1).setNumberFormat('dd/mm/yyyy');
  fs.getRange(2, 3, 999, 5).setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 5)
    .setAllowInvalid(false).setHelpText('Note de 0 à 5').build());
}

/** Colonnes calculées : métrologie (échéance, statut, proposition) et score 5S. */
function writeComputed_(k, data) {
  const S = CC.SHEETS;
  const T = THEME_;
  const me = sheet_(S.METRO, false);
  if (me && data.instruments.length) {
    const byId = {};
    k.metro.list.forEach((m) => { byId[m.id] = m; });
    const header = me.getRange(1, 1, 1, me.getLastColumn()).getValues()[0];
    const c0 = header.indexOf(METRO_COMPUTED_[0]) + 1 || SPECS_.METRO.length + 1;
    const ids = me.getRange(2, 1, me.getLastRow() - 1, 1).getValues().map((r) => String(r[0]).trim());
    const out = ids.map((id) => {
      const m = byId[id];
      return m ? [m.dueDate, m.daysLeft, m.status, m.suggestedJ, m.reason] : ['', '', '', '', ''];
    });
    me.getRange(1, c0, 1, METRO_COMPUTED_.length).setValues([METRO_COMPUTED_]);
    styleHeader_(me, c0 + METRO_COMPUTED_.length - 1);
    me.getRange(2, c0, out.length, METRO_COMPUTED_.length).setValues(out);
    me.getRange(2, c0, out.length, 1).setNumberFormat('dd/mm/yyyy');
    me.getRange(2, c0, out.length, METRO_COMPUTED_.length).setFontColor(T.MUTED).setFontStyle('italic');
    me.setConditionalFormatRules([]);
    statusRules_(me, c0 + 2, out.length, { 'En retard': [T.CRIT_BG, T.CRIT_INK], 'À planifier': [T.WARN_BG, T.WARN_INK], 'Valide': [T.GOOD_BG, T.GOOD_INK] });
  }
  const fs = sheet_(S.FIVE_S, false);
  if (fs && fs.getLastRow() > 1) {
    const n = fs.getLastRow() - 1;
    const v = fs.getRange(2, 3, n, 5).getValues();
    fs.getRange(2, 9, n, 1).setValues(v.map((r) => [round_(100 * r.reduce((x, y) => x + (Number(y) || 0), 0) / 25, 0)]));
    fs.setConditionalFormatRules([SpreadsheetApp.newConditionalFormatRule()
      .setGradientMinpointWithValue(T.CRIT_BG, SpreadsheetApp.InterpolationType.NUMBER, '40')
      .setGradientMidpointWithValue('#ffffff', SpreadsheetApp.InterpolationType.NUMBER, '65')
      .setGradientMaxpointWithValue(T.GOOD_BG, SpreadsheetApp.InterpolationType.NUMBER, '90')
      .setRanges([fs.getRange(2, 9, n, 1)]).build()]);
  }

  const wipRows = k.wip.map((s) => {
    const t = k.times.find((x) => x.code === s.code) || {};
    const state = { good: 'Fluide', warning: 'À surveiller', serious: 'Saturé', critical: 'Goulot' }[s.level];
    return [s.code, s.name, s.capacity, s.queue, s.inProgress, s.total, s.oldestQueueH, t.opH, s.stdH,
      t.overStdPct === null ? '' : t.overStdPct / 100, t.waitH, state];
  });
  const wip = writeTable_(S.WIP, ['Poste', 'Désignation', 'Capacité', 'En file', 'En cours', 'Total', 'Plus ancienne attente (h)',
    'Opération moy. 14 j (h)', 'Standard (h)', 'Écart au standard', 'Attente moy. 14 j (h)', 'État'], wipRows,
  { widths: [60, 200, 75, 70, 75, 60, 120, 120, 90, 100, 120, 100] });
  wip.getRange(2, 10, wipRows.length, 1).setNumberFormat('+0%;-0%;0%');
  statusRules_(wip, 12, wipRows.length, { 'Fluide': [T.GOOD_BG, T.GOOD_INK], 'À surveiller': [T.WARN_BG, T.WARN_INK],
    'Saturé': [T.WARN_BG, T.CRIT_INK], 'Goulot': [T.CRIT_BG, T.CRIT_INK] });
}

// ------------------------------------------------------------------ tableau de bord dans la feuille

function writeDashboardSheet_(k) {
  const T = THEME_;
  const sh = sheet_(CC.SHEETS.DASHBOARD, true);
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.getCharts().forEach((c) => sh.removeChart(c));
  sh.setHiddenGridlines(true);
  sh.setColumnWidth(1, 18);
  for (let c = 2; c <= 13; c += 1) sh.setColumnWidth(c, 92);
  sh.getRange(1, 1, 80, 14).setFontFamily(T.FONT).setFontColor(T.INK);

  sh.getRange('B2').setValue('Cadence Cockpit').setFontSize(22).setFontWeight('bold').setFontColor(T.HEADER_BG);
  sh.getRange('B3').setValue('Ligne d\'assemblage, ' + k.line.length + ' postes · données au ' + fmtDateTime_(k.generatedAt)
    + ' · menu Cockpit > Ouvrir le tableau de bord pour la vue complète').setFontColor(T.MUTED).setFontSize(10);

  const tiles = [
    ['Livraisons 7 j', k.flow.delivered7 + ' / ' + k.flow.due7, 'lots livrés / prévus'],
    ['Respect du plan', (k.flow.onTimePct === null ? '-' : k.flow.onTimePct + ' %'), 'sur 28 jours'],
    ['Encours', String(k.wipTotal), k.bottleneck ? 'goulot : ' + k.bottleneck.code : 'pas de goulot'],
    ['Traversée', fmtNum_(k.flow.leadTimeH) + ' h', 'standard ' + fmtNum_(k.flow.leadTimeStdH) + ' h'],
    ['Arrêts aléas 7 j', fmtNum_(k.aleas.stopH7) + ' h', k.aleas.count7 + ' aléas'],
    ['Métrologie', String(k.metro.late.length), 'instrument(s) en retard'],
  ];
  tiles.forEach((t, i) => {
    const col = 2 + 2 * i;
    const crit = (i === 5 && k.metro.late.length) || (i === 2 && k.bottleneck && k.bottleneck.queue >= 3);
    sh.getRange(5, col, 1, 2).merge().setValue(t[0]).setFontSize(9).setFontColor(T.MUTED).setFontWeight('bold');
    sh.getRange(6, col, 1, 2).merge().setValue(t[1]).setFontSize(20).setFontWeight('bold')
      .setFontColor(crit ? T.CRIT_INK : T.HEADER_BG);
    sh.getRange(7, col, 1, 2).merge().setValue(t[2]).setFontSize(9).setFontColor(T.MUTED);
    sh.getRange(5, col, 3, 2).setBackground(crit ? T.CRIT_BG : T.BAND)
      .setBorder(true, true, true, true, false, false, '#ffffff', SpreadsheetApp.BorderStyle.SOLID_THICK);
  });
  sh.setRowHeight(6, 36);

  let r = 9;
  const section = (title) => {
    sh.getRange(r, 2, 1, 12).merge().setValue(title).setFontSize(12).setFontWeight('bold').setFontColor(T.HEADER_BG)
      .setBorder(null, null, true, null, null, null, T.ACCENT, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    r += 1;
  };
  const cell = (row, col, n) => (n > 1 ? sh.getRange(row, col, 1, n).merge() : sh.getRange(row, col));
  const table = (headers, rows, widthsCols) => {
    const cols = widthsCols || headers.map(() => 1);
    let c = 2;
    headers.forEach((h, i) => {
      cell(r, c, cols[i]).setValue(h).setFontWeight('bold').setFontSize(9).setFontColor(T.MUTED);
      c += cols[i];
    });
    r += 1;
    rows.forEach((row) => {
      c = 2;
      row.forEach((v, i) => { cell(r, c, cols[i]).setValue(v).setFontSize(10); c += cols[i]; });
      r += 1;
    });
    if (!rows.length) { sh.getRange(r, 2).setValue('Rien à signaler').setFontColor(T.MUTED); r += 1; }
    r += 1;
  };

  section('Aléas récurrents (' + CC.RECURRENCE.WINDOW_DAYS + ' derniers jours)');
  table(['Poste', 'Catégorie', 'Nombre', 'Minutes', 'Tendance 14 j', 'Action durable'],
    k.aleas.recurrences.map((x) => [x.poste, x.categorie, x.count, x.minutes, x.trend, x.hasDurable ? x.durable : 'AUCUNE']),
    [1, 2, 1, 1, 2, 5]);
  section('Métrologie : instruments à traiter');
  table(['Instrument', 'Désignation', 'Poste', 'Échéance', 'Statut'],
    k.metro.late.concat(k.metro.toPlan).map((m) => [m.id, m.designation, m.poste, fmtDate_(m.dueDate), m.status]),
    [2, 5, 1, 2, 2]);
  section('Lissage des étalonnages : ' + k.metro.leveling.moves.length + ' avancement(s) proposés, pic de '
    + k.metro.leveling.peakBefore + ' à ' + k.metro.leveling.peakAfter + ' par semaine');
  table(['Instrument', 'Désignation', 'Poste', 'Semaine prévue', 'Semaine proposée'],
    k.metro.leveling.moves.map((m) => [m.id, m.designation, m.poste, m.from, m.to]), [2, 5, 1, 2, 2]);

  // Données des graphiques, à droite, en petit.
  const base = 16;
  const pareto = [['Catégorie', 'Minutes d\'arrêt (28 j)']].concat(k.aleas.paretoCategorie.map((p) => [p.key, p.minutes]));
  sh.getRange(1, base, pareto.length, 2).setValues(pareto);
  const weekly = [['Semaine', 'Livrés', 'Prévus']].concat(k.flow.weekly.map((w) => [w.week, w.delivered, w.planned]));
  sh.getRange(1, base + 3, weekly.length, 3).setValues(weekly);
  sh.getRange(1, base, 20, 6).setFontColor('#9a9a95').setFontSize(8);

  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(1, base, pareto.length, 2)).setPosition(r + 1, 2, 0, 0)
    .setOption('title', 'Pareto des aléas, minutes d\'arrêt sur 28 jours').setOption('legend', { position: 'none' })
    .setOption('colors', [T.ACCENT]).setOption('width', 560).setOption('height', 300).build());
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(sh.getRange(1, base + 3, weekly.length, 3)).setPosition(r + 1, 8, 0, 0)
    .setOption('title', 'Lots livrés et prévus par semaine').setOption('colors', [T.ACCENT, '#c3c2b7'])
    .setOption('width', 560).setOption('height', 300).build());
  return sh;
}

/** Onglet Paramètres : mode d'emploi et date de référence de la démonstration. */
function writeParams_(refDate) {
  const sh = sheet_(CC.SHEETS.PARAMS, true);
  sh.clear();
  const rows = [
    ['Paramètre', 'Valeur', 'Explication'],
    ['Date de référence', refDate || '', 'Vide = maintenant. Remplie par la démonstration pour figer « aujourd\'hui ».'],
    ['Takt (h ouvrées)', CC.TAKT_H, 'Un lot lancé toutes les ' + CC.TAKT_H + ' heures ouvrées.'],
    ['Fenêtre de récurrence (j)', CC.RECURRENCE.WINDOW_DAYS, 'Période d\'analyse des aléas répétés.'],
    ['Seuil de récurrence', CC.RECURRENCE.MIN_COUNT, 'Nombre d\'aléas même poste, même catégorie.'],
    ['Anticipation métrologie (j)', CC.METRO.PLAN_AHEAD_DAYS, 'Délai avant échéance pour passer « À planifier ».'],
    ['Modèle Gemini', CC.GEMINI_MODEL, 'Clé à saisir par le menu Cockpit > Configurer Gemini (jamais dans la feuille).'],
    ['Version', CC.VERSION, ''],
  ];
  writeTable_(CC.SHEETS.PARAMS, rows[0], rows.slice(1), { widths: [200, 160, 520] });
  if (refDate) sh.getRange(2, 2).setNumberFormat('dd/mm/yyyy hh:mm');
}

function referenceNow_() {
  const sh = sheet_(CC.SHEETS.PARAMS, false);
  if (sh && sh.getLastRow() >= 2) {
    const v = toDate_(sh.getRange(2, 2).getValue());
    if (v) return v;
  }
  return new Date();
}

/** Ordre et couleur des onglets. */
function arrangeTabs_() {
  const ss = ss_();
  const S = CC.SHEETS;
  const order = [S.DASHBOARD, S.WIP, S.ALEAS, S.METRO, S.FIVE_S, S.MOVES, S.PLAN, S.BRIEF, S.PARAMS];
  const colors = { [S.DASHBOARD]: '#0d366b', [S.WIP]: '#2a78d6', [S.ALEAS]: '#d03b3b', [S.METRO]: '#eda100',
    [S.FIVE_S]: '#1baf7a' };
  order.forEach((name, i) => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
    if (colors[name]) sh.setTabColor(colors[name]);
  });
  ss.getSheets().forEach((sh) => {
    if (order.indexOf(sh.getName()) < 0 && sh.getLastRow() === 0 && ss.getSheets().length > order.length) ss.deleteSheet(sh);
  });
  ss.setActiveSheet(ss.getSheetByName(S.DASHBOARD));
}
