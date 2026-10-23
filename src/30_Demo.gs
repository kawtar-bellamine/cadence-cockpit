/**
 * Jeu de données de démonstration : huit semaines d'une ligne d'assemblage simulée.
 *
 * Aucune donnée réelle d'entreprise : la ligne, les lots, les aléas et les instruments sont simulés.
 * Trois situations sont volontairement injectées pour que le cockpit ait quelque chose à trouver :
 *   1. P30 : usure d'outillage de perçage, de plus en plus fréquente depuis trois semaines, sans action durable ;
 *   2. P20 : manques pièces il y a un à deux mois, traités par un kanban fournisseur (action durable efficace) ;
 *   3. P50 : un micromètre passé hors validité d'étalonnage, qui provoque des mesures reportées.
 */

const ALEA_TEMPLATES_ = {
  'Outillage': {
    meanMin: 150, resp: 'Méthodes',
    text: ['Usure de l\'effecteur de perçage, diamètres de trous en limite de tolérance',
      'Foret cassé sur la riveteuse automatique', 'Effecteur de perçage à réaffûter, bavures en sortie de trou'],
    palliative: 'Changement du foret et contrôle renforcé des diamètres',
  },
  'Manque pièce': {
    meanMin: 140, resp: 'Logistique',
    text: ['Kit de cadres incomplet, clips manquants', 'Ferrures non livrées par le fournisseur',
      'Rupture d\'appro sur les éclisses'],
    palliative: 'Prélèvement sur le stock de sécurité et relance fournisseur',
  },
  'Non-conformité': {
    meanMin: 120, resp: 'Qualité',
    text: ['Rayure sur panneau, dérogation demandée', 'Défaut d\'alignement des cadres, reprise nécessaire',
      'Fixation hors tolérance de serrage, reprise'],
    palliative: 'Reprise au poste après accord qualité',
  },
  'Moyen de mesure': {
    meanMin: 70, resp: 'Qualité (métrologie)',
    text: ['Micromètre MIC-5003 hors validité d\'étalonnage, mesure reportée'],
    palliative: 'Prêt d\'un micromètre du laboratoire de métrologie',
  },
  'Documentation': {
    meanMin: 40, resp: 'Méthodes',
    text: ['Gamme de montage à un indice périmé', 'Instruction de travail absente au poste'],
    palliative: 'Impression de la gamme au bon indice',
  },
  'Main-d\'œuvre': {
    meanMin: 60, resp: 'Chef d\'équipe',
    text: ['Opérateur habilité absent, remplaçant en formation', 'Effectif réduit sur l\'équipe d\'après-midi'],
    palliative: 'Renfort d\'un opérateur polyvalent',
  },
};

/** Probabilité qu'un aléa d'une catégorie survienne pendant l'opération d'un lot, selon le scénario. */
function aleaProbability_(poste, cat, daysBeforeNow) {
  if (poste === 'P30' && cat === 'Outillage') return daysBeforeNow <= 21 ? 0.32 : 0.04;
  if (poste === 'P20' && cat === 'Manque pièce') return daysBeforeNow > 24 && daysBeforeNow <= 50 ? 0.22 : 0.02;
  if (poste === 'P50' && cat === 'Moyen de mesure') return daysBeforeNow <= 9 ? 0.3 : 0;
  if (poste === 'P40' && cat === 'Non-conformité') return 0.06;
  if (cat === 'Documentation' || cat === 'Main-d\'œuvre') return 0.015;
  if (cat === 'Non-conformité') return 0.02;
  return 0;
}

function generateDemo_(now, seed) {
  const r = rng_(seed === undefined ? CC.DEMO_SEED : seed);
  const origin = addDays_(mondayOf_(now), -7 * 8);
  const hNow = dateToWorkHours_(origin, now);
  const toDate = (h) => workHoursToDate_(origin, h);
  const line = CC.LINE;
  const free = line.map((p) => new Array(p.capacity).fill(0));
  const plan = [];
  const moves = [];
  const aleas = [];

  for (let i = 0; i * CC.TAKT_H <= hNow; i += 1) {
    const lot = 'B-' + String(401 + i).padStart(4, '0');
    const release = i * CC.TAKT_H;
    plan.push({ lot, lancement: toDate(release), livraisonPrevue: toDate(release + CC.DUE_MARGIN_H) });
    let arrival = release;
    for (let s = 0; s < line.length; s += 1) {
      if (arrival > hNow) break;
      const p = line[s];
      const srv = free[s].indexOf(Math.min.apply(null, free[s]));
      const start = Math.max(arrival, free[s][srv]);
      const proc = p.stdH * Math.exp(0.08 * r.normal());
      let delay = 0;
      CC.ALEA_CATEGORIES.forEach((cat) => {
        const t = start + r() * proc;
        const prob = aleaProbability_(p.code, cat, (hNow - t) / CC.WORK_HOURS_PER_DAY);
        if (r() >= prob) return;
        const tpl = ALEA_TEMPLATES_[cat];
        const minutes = Math.round(tpl.meanMin * Math.exp(0.35 * r.normal()) / 5) * 5;
        delay += minutes / 60;
        if (t <= hNow) aleas.push({ t, poste: p.code, lot, categorie: cat, minutes, text: r.pick(tpl.text) });
      });
      const end = start + proc + delay;
      free[s][srv] = end;
      moves.push({ lot, poste: p.code, entree: toDate(arrival), debut: start <= hNow ? toDate(start) : null,
        sortie: end <= hNow ? toDate(end) : null });
      arrival = end;
    }
  }

  aleas.sort((a, b) => a.t - b.t);
  const kanbanDecided = addDays_(now, -30);
  const aleaRows = aleas.map((a, i) => {
    const date = toDate(a.t);
    const age = daysBetween_(date, now);
    const tpl = ALEA_TEMPLATES_[a.categorie];
    let durable = '';
    if (a.poste === 'P20' && a.categorie === 'Manque pièce' && date < addDays_(kanbanDecided, 12)) {
      durable = 'Kanban fournisseur à deux bacs pour les clips et ferrures';
    } else if (a.categorie === 'Non-conformité' && r() < 0.5) {
      durable = 'Mise à jour du standard de travail et point flash équipe';
    } else if (a.categorie === 'Documentation' && r() < 0.7) {
      durable = 'Gammes servies par le système documentaire au bon indice';
    }
    const statut = age < 3 ? 'Ouvert' : durable && age > 7 ? 'Clos' : 'En cours';
    return { id: 'AL-' + String(i + 1).padStart(4, '0'), date, poste: a.poste, lot: a.lot, categorie: a.categorie,
      description: a.text, arretMin: a.minutes, palliative: tpl.palliative, durable, responsable: tpl.resp,
      echeance: durable ? addDays_(date, 10) : '', statut };
  });

  return { plan, moves, aleas: aleaRows, instruments: demoInstruments_(now, r), audits: demoAudits_(now, r),
    origin };
}

function demoInstruments_(now, r) {
  const types = {
    PAC: { name: 'Pied à coulisse numérique 0-150 mm', type: 'Pied à coulisse', ref: 365 },
    MIC: { name: 'Micromètre d\'extérieur 0-25 mm', type: 'Micromètre', ref: 365 },
    CLE: { name: 'Clé dynamométrique 4-20 N·m', type: 'Clé dynamométrique', ref: 180 },
    COM: { name: 'Comparateur 0,01 mm', type: 'Comparateur', ref: 365 },
    JPF: { name: 'Jauge de profondeur de fraisure', type: 'Jauge', ref: 180 },
    CTL: { name: 'Calibre tampon lisse Ø4,8', type: 'Calibre', ref: 365 },
    RAP: { name: 'Rapporteur d\'angle numérique', type: 'Rapporteur', ref: 730 },
  };
  const park = { P10: ['PAC', 'PAC', 'MIC'], P20: ['PAC', 'CLE', 'CLE', 'RAP'], P30: ['JPF', 'JPF', 'CTL', 'CTL', 'PAC'],
    P40: ['CLE', 'CLE', 'CLE', 'CLE', 'PAC', 'PAC'], P50: ['MIC', 'MIC', 'MIC', 'COM', 'COM', 'PAC', 'RAP'],
    P60: ['PAC', 'RAP'] };
  const out = [];
  let cluster = 0;
  Object.keys(park).forEach((poste) => {
    const seq = {};
    park[poste].forEach((pre) => {
      seq[pre] = (seq[pre] || 0) + 1;
      const t = types[pre];
      const id = pre + '-' + poste.slice(1) + String(seq[pre]).padStart(2, '0');
      let period = t.ref;
      let hist = r() < 0.5 ? 'C,C,C' : 'C,C';
      if (r() < 0.2) { period = Math.round(t.ref * 1.25); hist = 'C,C,C,C'; }
      let daysLeft = r.int(10, period - 5);
      if (pre === 'CLE' && poste === 'P40' && seq[pre] <= 2) hist = 'C,C,NC';
      if (id === 'MIC-5003') { daysLeft = -9; hist = 'C,C'; period = t.ref; }
      if (id === 'JPF-3002') { daysLeft = -4; hist = 'C,C,C'; period = t.ref; }
      // Grappe d'échéances dans la même semaine pour montrer l'intérêt du lissage.
      if (['PAC', 'COM', 'CTL'].indexOf(pre) >= 0 && cluster < 7 && id !== 'MIC-5003') {
        cluster += 1;
        daysLeft = 7 * 5 + r.int(0, 3);
      }
      out.push({ id, designation: t.name, type: t.type, poste, dernierEtalonnage: addDays_(startOfDay_(now), daysLeft - period),
        periodiciteJ: period, periodiciteRefJ: t.ref, historique: hist });
    });
  });
  return out;
}

function demoAudits_(now, r) {
  const out = [];
  const w0 = mondayOf_(now);
  for (let w = 7; w >= 0; w -= 1) {
    const monday = addDays_(w0, -7 * w);
    CC.LINE.forEach((p) => {
      const base = { P10: 3.8, P20: 3.0, P30: 3.9, P40: 3.4, P50: 4.2, P60: 3.6 }[p.code];
      let trend = 0;
      if (p.code === 'P20') trend = (7 - w) * 0.14; // standardisation après le kanban
      if (p.code === 'P30' && w <= 2) trend = -(3 - w) * 0.45; // copeaux et outillage en vrac
      const s = (k) => Math.max(1, Math.min(5, Math.round(base + trend + (k === 's3' && p.code === 'P30' ? trend : 0)
        + 0.45 * r.normal())));
      out.push({ semaine: monday, poste: p.code, s1: s('s1'), s2: s('s2'), s3: s('s3'), s4: s('s4'), s5: s('s5'),
        auditeur: 'Animateur 5S' });
    });
  }
  return out;
}
