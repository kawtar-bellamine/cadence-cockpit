/**
 * Points d'entrée : menu, tableau de bord HTML, formulaire de déclaration d'aléa, déclencheur quotidien.
 * Les fonctions sans "_" final sont appelables depuis le menu ou depuis les pages HTML (google.script.run).
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Cockpit')
    .addItem('Ouvrir le tableau de bord', 'openDashboard')
    .addItem('Déclarer un aléa', 'openAleaForm')
    .addSeparator()
    .addItem('Rafraîchir les indicateurs', 'refreshAll')
    .addItem('Générer le brief du jour', 'generateBriefFromMenu')
    .addSeparator()
    .addItem('Configurer Gemini', 'configureGemini')
    .addItem('Activer la mise à jour quotidienne (6 h)', 'installDailyTrigger')
    .addItem('Initialiser la démonstration', 'initDemo')
    .addToUi();
}

// ------------------------------------------------------------------ démonstration et rafraîchissement

function initDemo() {
  const ui = SpreadsheetApp.getUi();
  if (ss_().getSheetByName(CC.SHEETS.ALEAS)) {
    const ok = ui.alert('Initialiser la démonstration', 'Les onglets du cockpit vont être remplacés par huit semaines de '
      + 'données simulées. Continuer ?', ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }
  initDemo_(new Date());
  ss_().toast('Démonstration prête : huit semaines simulées, ' + CC.LINE.length + ' postes.', 'Cadence Cockpit', 6);
}

function initDemo_(now) {
  const d = generateDemo_(now, CC.DEMO_SEED);
  writeParams_(now);
  writeSources_(d);
  const k = refreshAll_();
  writeBriefRow_(composeBrief_(k), now);
  arrangeTabs_();
  return d;
}

function refreshAll() {
  const k = refreshAll_();
  ss_().toast('Indicateurs à jour : ' + k.wipTotal + ' lots en cours, ' + k.aleas.recurrences.length
    + ' récurrence(s), ' + k.metro.late.length + ' instrument(s) en retard.', 'Cadence Cockpit', 5);
}

function refreshAll_() {
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const data = readAll_();
    const k = buildKpis_(data, referenceNow_());
    writeComputed_(k, data);
    writeDashboardSheet_(k);
    return k;
  } finally {
    lock.releaseLock();
  }
}

function dailyRun() {
  const k = refreshAll_();
  writeBriefRow_(composeBrief_(k), new Date());
}

function installDailyTrigger() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'dailyRun').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyRun').timeBased().atHour(6).everyDays(1).inTimezone(CC.TIMEZONE).create();
  ss_().toast('Mise à jour et brief générés chaque jour vers 6 h.', 'Cadence Cockpit', 5);
}

// ------------------------------------------------------------------ brief

function writeBriefRow_(b, when) {
  const sh = sheet_(CC.SHEETS.BRIEF, true);
  const headers = ['Date', 'Source', 'Contrôle des chiffres', 'Texte'];
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues() : [];
  const rows = [[when, b.source, b.check, b.text]].concat(old).slice(0, 60);
  writeTable_(CC.SHEETS.BRIEF, headers, rows, { dateCols: [1], widths: [130, 170, 260, 720] });
  sh.getRange(2, 4, rows.length, 1).setWrap(true);
}

function generateBrief() {
  const k = buildKpis_(readAll_(), referenceNow_());
  const b = composeBrief_(k);
  writeBriefRow_(b, new Date());
  return b;
}

function generateBriefFromMenu() {
  const b = generateBrief();
  SpreadsheetApp.getUi().alert('Brief du jour (' + b.source + ')', b.text + '\n\n' + b.check, SpreadsheetApp.getUi().ButtonSet.OK);
}

function configureGemini() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Configurer Gemini', 'Collez votre clé API Gemini (Google AI Studio). Elle est stockée dans les '
    + 'propriétés du script, pas dans la feuille. Laissez vide pour désactiver.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  const props = PropertiesService.getScriptProperties();
  if (key) props.setProperty(CC.GEMINI_KEY_PROPERTY, key);
  else props.deleteProperty(CC.GEMINI_KEY_PROPERTY);
  ss_().toast(key ? 'Clé Gemini enregistrée.' : 'Gemini désactivé.', 'Cadence Cockpit', 4);
}

// ------------------------------------------------------------------ pages HTML

function openDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Dashboard').setWidth(1320).setHeight(880);
  SpreadsheetApp.getUi().showModelessDialog(html, 'Cadence Cockpit');
}

function openAleaForm() {
  const html = HtmlService.createHtmlOutputFromFile('AleaForm').setTitle('Déclarer un aléa');
  SpreadsheetApp.getUi().showSidebar(html);
}

/** Application web : même tableau de bord, en plein écran (Déployer > Application web). */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard').setTitle('Cadence Cockpit')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** google.script.run ne transporte pas les objets Date : on renvoie du JSON simple. */
function getDashboardData() {
  const k = buildKpis_(readAll_(), referenceNow_());
  const sh = sheet_(CC.SHEETS.BRIEF, false);
  let brief = null;
  if (sh && sh.getLastRow() > 1) {
    const r = sh.getRange(2, 1, 1, 4).getValues()[0];
    brief = { date: toDate_(r[0]), source: r[1], check: r[2], text: r[3] };
  }
  return JSON.parse(JSON.stringify({ kpis: k, brief, gemini: Boolean(geminiKey_()), version: CC.VERSION,
    categories: CC.ALEA_CATEGORIES }));
}

function getFormConfig() {
  const data = readAll_();
  const now = referenceNow_();
  const wip = computeWip_(data.moves, now, CC.LINE);
  return {
    postes: CC.LINE.map((p) => ({ code: p.code, name: p.name, lots: (wip.find((w) => w.code === p.code) || { lots: [] }).lots.map((l) => l.lot) })),
    categories: CC.ALEA_CATEGORIES.slice(),
    gemini: Boolean(geminiKey_()),
  };
}

function suggestCategory(text) {
  return classifyAlea_(text);
}

/** Empêche qu'un texte saisi soit interprété comme une formule par Sheets. */
function safeText_(v, max) {
  const s = String(v === undefined || v === null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, max || 300);
  return /^[=+\-@]/.test(s) ? '\'' + s : s;
}

function validateAlea_(f) {
  const errors = [];
  const poste = String(f.poste || '');
  if (!CC.LINE.some((p) => p.code === poste)) errors.push('Poste inconnu');
  if (CC.ALEA_CATEGORIES.indexOf(f.categorie) < 0) errors.push('Catégorie inconnue');
  const minutes = Number(f.arretMin);
  if (!isFinite(minutes) || minutes < 0 || minutes > 1440) errors.push('Arrêt entre 0 et 1440 minutes');
  if (String(f.description || '').trim().length < 5) errors.push('Description trop courte');
  return errors;
}

function submitAlea(f) {
  const errors = validateAlea_(f || {});
  if (errors.length) throw new Error(errors.join(' ; '));
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_(CC.SHEETS.ALEAS, false);
    if (!sh) throw new Error('Onglet Aléas absent : initialisez le cockpit.');
    const n = sh.getLastRow();
    const ids = n > 1 ? sh.getRange(2, 1, n - 1, 1).getValues().map((r) => Number(String(r[0]).replace(/\D/g, '')) || 0) : [];
    const id = 'AL-' + String(Math.max.apply(null, [0].concat(ids)) + 1).padStart(4, '0');
    const row = [id, referenceNow_(), f.poste, safeText_(f.lot, 20), f.categorie, safeText_(f.description, 300),
      Math.round(Number(f.arretMin)), safeText_(f.palliative, 300), safeText_(f.durable, 300), safeText_(f.responsable, 80),
      '', 'Ouvert'];
    sh.getRange(n + 1, 1, 1, row.length).setValues([row]);
    sh.getRange(n + 1, 2).setNumberFormat('dd/mm/yyyy hh:mm');
    return { id, recurrence: detectRecurrence_(readAll_().aleas, referenceNow_())
      .filter((r) => r.poste === f.poste && r.categorie === f.categorie)[0] || null };
  } finally {
    lock.releaseLock();
  }
}
