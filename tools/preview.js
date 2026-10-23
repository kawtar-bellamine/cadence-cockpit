/**
 * Aperçu local des pages HTML, sans compte Google : on exécute le vrai code Apps Script sur une feuille simulée
 * (tests/harness.js) et on branche ses réponses à la place de google.script.run.
 * Usage : node tools/preview.js  ->  build/preview_dashboard.html, build/preview_form.html
 */
const fs = require('fs');
const path = require('path');
const { load } = require('../tests/harness');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'build');
fs.mkdirSync(OUT, { recursive: true });

const now = new Date(2026, 9, 22, 14, 30);
const { g } = load();
g.initDemo_(now);
const data = g.getDashboardData();
const form = g.getFormConfig();
const suggestions = {};
['Foret cassé sur la riveteuse, trous ovalisés', 'Clips manquants dans le kit', 'Micromètre hors validité'].forEach((t) => {
  suggestions[t] = g.suggestCategory(t);
});

function inject(file, api) {
  const html = fs.readFileSync(path.join(ROOT, 'src', file), 'utf8');
  const shim = `<script>window.LOCAL_API = ${api};</script>`;
  return html.replace('<body>', `<body>\n${shim}`);
}

fs.writeFileSync(path.join(OUT, 'preview_dashboard.html'), inject('Dashboard.html', `{
  getDashboardData: function () { return ${JSON.stringify(data)}; },
  generateBrief: function () { return {}; }
}`));
if (fs.existsSync(path.join(ROOT, 'src', 'AleaForm.html'))) {
  fs.writeFileSync(path.join(OUT, 'preview_form.html'), inject('AleaForm.html', `{
    getFormConfig: function () { return ${JSON.stringify(form)}; },
    suggestCategory: function (t) { var s = ${JSON.stringify(suggestions)}; return s[t] || { categorie: 'Outillage', source: 'règles', confidence: 'élevée' }; },
    submitAlea: function (f) { return { id: 'AL-0052', recurrence: { poste: f.poste, categorie: f.categorie, count: 11, level: 'critical' } }; }
  }`));
}
fs.writeFileSync(path.join(OUT, 'dashboard_data.json'), JSON.stringify(data, null, 1));
console.log('ok', Object.keys(data.kpis).length, 'blocs');
