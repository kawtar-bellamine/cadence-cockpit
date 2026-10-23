const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { load } = require('./harness');

const NOW = new Date(2026, 9, 22, 14, 30);
const D = (day, h = 10) => new Date(2026, 9, day, h, 0);

test('chaque fichier .gs est du JavaScript valide (runtime V8)', () => {
  const src = path.join(__dirname, '..', 'src');
  fs.readdirSync(src).filter((f) => f.endsWith('.gs')).forEach((f) => {
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(src, f), 'utf8'), { filename: f }), f);
  });
});

test('calendrier ouvré : aller-retour heures ouvrées <-> date', () => {
  const { g } = load();
  const origin = new Date(2026, 7, 31); // lundi
  for (const h of [0, 3.5, 15.9, 16, 47.25, 80, 333.3]) {
    const d = g.workHoursToDate_(origin, h);
    assert.ok([0, 6].indexOf(d.getDay()) < 0, 'jamais un week-end');
    assert.ok(Math.abs(g.dateToWorkHours_(origin, d) - h) < 1e-6, `h=${h}`);
  }
});

test('démonstration reproductible et cohérente (dates, capacité des postes)', () => {
  const { g } = load();
  const a = g.generateDemo_(NOW, 7);
  const b = g.generateDemo_(NOW, 7);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  a.moves.forEach((m) => {
    if (m.debut) assert.ok(m.entree <= m.debut);
    if (m.sortie) assert.ok(m.debut && m.debut <= m.sortie);
    assert.ok(m.entree <= NOW);
  });
  const { CC } = g;
  CC.LINE.forEach((p) => {
    const mv = a.moves.filter((m) => m.poste === p.code && m.debut);
    mv.forEach((m) => {
      const busy = mv.filter((x) => x.debut <= m.debut && (!x.sortie || x.sortie > m.debut)).length;
      assert.ok(busy <= p.capacity, `${p.code} dépasse sa capacité`);
    });
  });
});

test('encours : file, en cours et niveau du poste', () => {
  const { g } = load();
  const line = [{ code: 'A', name: 'A', capacity: 1, stdH: 1 }, { code: 'B', name: 'B', capacity: 1, stdH: 1 }];
  const moves = [
    { lot: 'L1', poste: 'A', entree: D(20), debut: D(20), sortie: D(20, 12) },
    { lot: 'L1', poste: 'B', entree: D(20, 12), debut: D(20, 12), sortie: null },
    { lot: 'L2', poste: 'B', entree: D(21), debut: null, sortie: null },
    { lot: 'L3', poste: 'B', entree: D(21, 11), debut: null, sortie: null },
    { lot: 'L4', poste: 'B', entree: D(21, 12), debut: null, sortie: null },
    { lot: 'L5', poste: 'A', entree: D(23), debut: null, sortie: null }, // futur : ignoré
  ];
  const [a, b] = g.computeWip_(moves, NOW, line);
  assert.equal(a.total, 0);
  assert.equal(b.inProgress, 1);
  assert.equal(b.queue, 3);
  assert.equal(b.level, 'critical');
  assert.equal(a.level, 'good');
});

test('récurrence : seuil, fenêtre et action durable', () => {
  const { g } = load();
  const al = (day, poste, cat, durable = '') => ({ date: day > 0 ? D(day) : new Date(2026, 8, 20 + day), poste, categorie: cat, arretMin: 60, durable, description: 'x' });
  const aleas = [
    al(15, 'P30', 'Outillage'), al(18, 'P30', 'Outillage'), al(21, 'P30', 'Outillage'),
    al(16, 'P20', 'Manque pièce', 'Kanban'), al(17, 'P20', 'Manque pièce'), al(19, 'P20', 'Manque pièce'),
    al(19, 'P10', 'Documentation'), al(20, 'P10', 'Documentation'),
    // Trois aléas P40 en septembre, hors fenêtre de 21 jours : un seul compte.
    al(-1, 'P40', 'Non-conformité'), al(-2, 'P40', 'Non-conformité'), al(-3, 'P40', 'Non-conformité'), al(20, 'P40', 'Non-conformité'),
  ];
  const r = g.detectRecurrence_(aleas, NOW);
  const key = (x) => `${x.poste}|${x.categorie}`;
  assert.deepEqual([...r.map(key)].sort(), ['P20|Manque pièce', 'P30|Outillage']);
  assert.equal(r.find((x) => x.poste === 'P30').level, 'critical');
  assert.equal(r.find((x) => x.poste === 'P20').level, 'warning');
  assert.equal(r[0].poste, 'P30', 'les alertes sans action durable passent en premier');
});

test('Pareto : tri par minutes et cumul à 100 %', () => {
  const { g } = load();
  const rows = g.paretoAleas_([
    { date: D(20), categorie: 'A', arretMin: 10 }, { date: D(20), categorie: 'B', arretMin: 70 },
    { date: D(21), categorie: 'A', arretMin: 20 }, { date: D(1), categorie: 'C', arretMin: 999 },
  ], D(10), 'categorie');
  assert.deepEqual(rows.map((r) => r.key), ['B', 'A']);
  assert.equal(rows[rows.length - 1].cumPct, 100);
});

test('métrologie : statut, raccourcissement après non-conformité, allongement plafonné', () => {
  const { g } = load();
  const base = { designation: 'x', type: 'x', poste: 'P50', periodiciteRefJ: 180 };
  const [late, nc, stable, capped, soon] = g.metrologyStatus_([
    { ...base, id: 'late', dernierEtalonnage: new Date(2026, 3, 1), periodiciteJ: 180, historique: 'C,C' },
    { ...base, id: 'nc', dernierEtalonnage: new Date(2026, 8, 1), periodiciteJ: 40, historique: 'C,NC' },
    { ...base, id: 'stable', dernierEtalonnage: new Date(2026, 8, 1), periodiciteJ: 180, historique: 'C,C,C' },
    { ...base, id: 'capped', dernierEtalonnage: new Date(2026, 8, 1), periodiciteJ: 350, historique: 'C;C;C;C' },
    { ...base, id: 'soon', dernierEtalonnage: new Date(2026, 4, 1), periodiciteJ: 180, historique: '' },
  ], NOW);
  assert.equal(late.status, 'En retard');
  assert.ok(late.daysLeft < 0);
  assert.equal(nc.suggestedJ, 30, 'jamais sous le minimum de 30 jours');
  assert.equal(stable.suggestedJ, 225);
  assert.equal(capped.suggestedJ, 360, 'plafond : 2 fois la périodicité de référence');
  assert.equal(soon.status, 'À planifier');
});

test('lissage des étalonnages : on avance, on ne retarde jamais, le pic baisse', () => {
  const { g } = load();
  const now = NOW;
  const items = [];
  for (let i = 0; i < 9; i += 1) items.push({ id: `X${i}`, poste: 'P10', designation: 'x', dueDate: g.addDays_(now, 35) });
  items.push({ id: 'Y', poste: 'P10', designation: 'x', dueDate: g.addDays_(now, 3) });
  const r = g.levelCalibrations_(items, now, 12, 2);
  assert.equal(r.leveled.reduce((a, b) => a + b, 0), r.load.reduce((a, b) => a + b, 0), 'aucun étalonnage perdu');
  assert.ok(r.peakAfter < r.peakBefore);
  assert.ok(r.leveled.every((v) => v <= 2));
  r.moves.forEach((m) => assert.ok(r.labels.indexOf(m.to) < r.labels.indexOf(m.from)));
});

test('classement par règles des aléas', () => {
  const { g } = load();
  assert.equal(g.classifyAleaRules_('Foret cassé sur la riveteuse').categorie, 'Outillage');
  assert.equal(g.classifyAleaRules_('Clips manquants, kit incomplet du fournisseur').categorie, 'Manque pièce');
  assert.equal(g.classifyAleaRules_('Micromètre hors validité d\'étalonnage').categorie, 'Moyen de mesure');
  assert.equal(g.classifyAleaRules_('Gamme à un indice périmé').categorie, 'Documentation');
  assert.equal(g.classifyAleaRules_('rien de spécial').categorie, '');
});

test('contrôle des chiffres : un nombre absent des faits est signalé, les codes sont ignorés', () => {
  const { g } = load();
  const facts = { a: 11, b: 15.8, c: 'P30 Perçage (3 lots en file)', d: ['MIC-5003 (9 j de retard)'] };
  assert.deepEqual(g.unverifiedNumbers_('11 lots, 15,8 h, P30 et MIC-5003 : 3 en file, 9 j.', facts), []);
  assert.deepEqual(g.unverifiedNumbers_('Le TRS est de 87 % sur P30.', facts), ['87']);
});

function geminiResponse(text) {
  return { code: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }) };
}

test('brief : sans clé, modèle de texte ; avec Gemini fidèle, texte accepté', () => {
  const now = NOW;
  let env = load();
  env.g.initDemo_(now);
  const k = env.g.buildKpis_(env.g.readAll_(), now);
  const off = env.g.composeBrief_(k);
  assert.equal(off.source, 'Modèle de texte');
  assert.match(off.check, /Pas de clé/);
  assert.equal(env.fetches.length, 0);

  const facts = env.g.briefFacts_(k);
  const faithful = `Point du ${facts.date}. ${facts.livraisons_7j} lots livrés pour ${facts.livraisons_prevues_7j} prévus.`;
  env = load({ properties: { GEMINI_API_KEY: 'test-key' }, fetch: () => geminiResponse(faithful) });
  const on = env.g.composeBrief_(k);
  assert.equal(on.text, faithful);
  assert.match(on.source, /^Gemini/);
  const call = env.fetches[0];
  assert.match(call.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  assert.equal(call.params.headers['x-goog-api-key'], 'test-key');
  assert.ok(!call.url.includes('test-key'), 'la clé ne passe jamais dans l\'URL');
});

test('brief : un texte Gemini avec un chiffre inventé est rejeté', () => {
  const env = load({ properties: { GEMINI_API_KEY: 'k' }, fetch: () => geminiResponse('Le TRS atteint 93,7 % cette semaine.') });
  env.g.initDemo_(NOW);
  const b = env.g.composeBrief_(env.g.buildKpis_(env.g.readAll_(), NOW));
  assert.equal(b.source, 'Modèle de texte');
  assert.match(b.check, /rejeté.*93,7/);
});

test('Gemini : nouvel essai sur erreur 503, puis texte de secours', () => {
  const env = load({ properties: { GEMINI_API_KEY: 'k' }, fetch: () => ({ code: 503, body: '' }) });
  assert.equal(env.g.callGemini_('x'), null);
  assert.equal(env.fetches.length, 2);
});

test('catégorie proposée par Gemini, validée contre la liste', () => {
  let env = load({ properties: { GEMINI_API_KEY: 'k' }, fetch: () => geminiResponse('Outillage') });
  assert.deepEqual({ ...env.g.classifyAlea_('pb sur la machine') }, { categorie: 'Outillage', source: 'Gemini', confidence: 'élevée' });
  env = load({ properties: { GEMINI_API_KEY: 'k' }, fetch: () => geminiResponse('Problème machine probable') });
  assert.equal(env.g.classifyAlea_('foret cassé').source, 'règles');
});

test('bout en bout : démonstration, onglets, situations injectées retrouvées', () => {
  const env = load();
  env.g.initDemo_(NOW);
  const names = env.ss.getSheets().map((s) => s.getName());
  ['Tableau de bord', 'Encours', 'Aléas', 'Métrologie', '5S', 'Mouvements', 'Plan', 'Brief', 'Paramètres']
    .forEach((n) => assert.ok(names.includes(n), n));
  assert.equal(names[0], 'Tableau de bord');
  const data = env.g.getDashboardData();
  assert.doesNotThrow(() => JSON.stringify(data));
  const k = data.kpis;
  assert.equal(k.bottleneck.code, 'P30');
  assert.equal(k.aleas.recurrences[0].poste, 'P30');
  assert.equal(k.aleas.recurrences[0].categorie, 'Outillage');
  assert.ok(k.metro.late.some((m) => m.id === 'MIC-5003'));
  assert.ok(k.aleas.recurrences.some((r) => r.poste === 'P50' && r.categorie === 'Moyen de mesure'));
  assert.ok(!k.aleas.recurrences.some((r) => r.poste === 'P20'), 'le kanban a fait disparaître les manques P20');
  assert.ok(k.metro.leveling.peakAfter < k.metro.leveling.peakBefore);
  const metro = env.ss.getSheetByName('Métrologie');
  const header = metro.getRange(1, 1, 1, metro.getLastColumn()).getValues()[0];
  assert.ok(header.includes('Statut') && header.includes('Périodicité proposée (j)'));
});

test('déclaration d\'aléa : validation, identifiant, protection contre les formules', () => {
  const env = load();
  env.g.initDemo_(NOW);
  assert.throws(() => env.g.submitAlea({ poste: 'P99', categorie: 'X', arretMin: -1, description: '' }), /Poste inconnu.*Catégorie inconnue.*Arrêt.*Description/);
  const before = env.ss.getSheetByName('Aléas').getLastRow();
  const r = env.g.submitAlea({ poste: 'P30', categorie: 'Outillage', arretMin: 40, description: '=HYPERLINK("x")', lot: '+B1' });
  const sh = env.ss.getSheetByName('Aléas');
  assert.equal(sh.getLastRow(), before + 1);
  const row = sh.getRange(sh.getLastRow(), 1, 1, 12).getValues()[0];
  assert.equal(row[0], r.id);
  assert.equal(row[5], '\'=HYPERLINK("x")');
  assert.equal(row[3], '\'+B1');
  assert.ok(r.recurrence && r.recurrence.count >= 3, 'la récurrence est signalée tout de suite');
});

test('lecture : une colonne renommée donne un message clair', () => {
  const env = load();
  env.g.initDemo_(NOW);
  env.ss.getSheetByName('Aléas').getRange(1, 5).setValue('Type');
  assert.throws(() => env.g.readAll_(), /Aléas.*Catégorie/);
});
