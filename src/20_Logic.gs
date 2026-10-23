/**
 * Logique métier pure : aucune dépendance aux services Google.
 * Ces fonctions prennent des objets JavaScript et renvoient des objets ; elles sont testées hors ligne avec Node.
 */

// ------------------------------------------------------------------ flux et encours

/** Heures ouvrées entre deux dates. */
function workHoursBetween_(a, b) {
  const o = mondayOf_(a);
  return dateToWorkHours_(o, b) - dateToWorkHours_(o, a);
}

/**
 * Encours par poste à l'instant `now`.
 * Un lot est en file s'il est entré sans avoir commencé, en cours s'il a commencé sans être sorti.
 */
function computeWip_(moves, now, line) {
  const byPoste = {};
  line.forEach((p) => {
    byPoste[p.code] = { code: p.code, name: p.name, capacity: p.capacity, stdH: p.stdH, queue: 0, inProgress: 0,
      total: 0, lots: [], oldestQueueH: 0 };
  });
  moves.forEach((m) => {
    const s = byPoste[m.poste];
    if (!s || !m.entree || m.entree > now) return;
    if (m.sortie && m.sortie <= now) return;
    const started = m.debut && m.debut <= now;
    if (started) s.inProgress += 1;
    else {
      s.queue += 1;
      s.oldestQueueH = Math.max(s.oldestQueueH, round_(workHoursBetween_(m.entree, now), 1));
    }
    s.total += 1;
    s.lots.push({ lot: m.lot, state: started ? 'en cours' : 'en file' });
  });
  return line.map((p) => {
    const s = byPoste[p.code];
    s.level = s.queue >= 3 ? 'critical' : s.queue >= 1 + p.capacity ? 'serious' : s.queue >= 1 ? 'warning' : 'good';
    return s;
  });
}

/** Encours total à la fin de chaque journée ouvrée, sur `days` jours. */
function wipHistory_(moves, now, days, codes) {
  const out = [];
  let d = startOfDay_(now);
  const points = [];
  while (points.length < days) {
    if (!isWeekend_(d)) points.unshift(new Date(d.getTime() + (CC.SHIFT_START_HOUR + CC.WORK_HOURS_PER_DAY) * HOUR_MS));
    d = addDays_(d, -1);
  }
  points[points.length - 1] = now < points[points.length - 1] ? now : points[points.length - 1];
  points.forEach((t) => {
    const row = { date: t, total: 0 };
    (codes || []).forEach((c) => { row[c] = 0; });
    moves.forEach((m) => {
      if (m.entree && m.entree <= t && (!m.sortie || m.sortie > t)) {
        row.total += 1;
        if (row[m.poste] !== undefined) row[m.poste] += 1;
      }
    });
    out.push(row);
  });
  return out;
}

/** Temps de séjour moyens par poste (attente et opération) sur les mouvements terminés depuis `since`. */
function stationTimes_(moves, since, line) {
  return line.map((p) => {
    const done = moves.filter((m) => m.poste === p.code && m.sortie && m.debut && m.sortie >= since);
    const op = done.map((m) => workHoursBetween_(m.debut, m.sortie));
    const wait = done.map((m) => workHoursBetween_(m.entree, m.debut));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const opAvg = avg(op);
    return { code: p.code, name: p.name, stdH: p.stdH, n: done.length,
      opH: opAvg === null ? null : round_(opAvg, 1), waitH: avg(wait) === null ? null : round_(avg(wait), 1),
      overStdPct: opAvg === null ? null : round_(100 * (opAvg / p.stdH - 1), 0) };
  });
}

/** Livraisons, respect du plan et temps de traversée. */
function flowKpis_(plan, moves, now, line) {
  const last = line[line.length - 1].code;
  const first = line[0].code;
  const out = {};
  moves.forEach((m) => {
    if (m.poste === last && m.sortie && m.sortie <= now) out[m.lot] = m.sortie;
  });
  const entry = {};
  moves.forEach((m) => { if (m.poste === first) entry[m.lot] = m.entree; });
  const d7 = addDays_(now, -7);
  const d28 = addDays_(now, -28);
  const delivered7 = Object.keys(out).filter((l) => out[l] > d7).length;
  const due7 = plan.filter((p) => p.livraisonPrevue > d7 && p.livraisonPrevue <= now).length;
  const due28 = plan.filter((p) => p.livraisonPrevue > d28 && p.livraisonPrevue <= now);
  const onTime = due28.filter((p) => out[p.lot] && out[p.lot] <= p.livraisonPrevue).length;
  const late = plan.filter((p) => p.livraisonPrevue <= now && !out[p.lot]).map((p) => ({
    lot: p.lot, prevue: p.livraisonPrevue, retardH: round_(workHoursBetween_(p.livraisonPrevue, now), 1) }));
  const lt = Object.keys(out).filter((l) => out[l] > d28 && entry[l]).map((l) => workHoursBetween_(entry[l], out[l]));
  const weekly = [];
  const w0 = mondayOf_(now);
  for (let i = 7; i >= 0; i -= 1) {
    const a = addDays_(w0, -7 * i);
    const b = addDays_(a, 7);
    weekly.push({ week: isoWeekLabel_(a), monday: a,
      delivered: Object.keys(out).filter((l) => out[l] >= a && out[l] < b).length,
      planned: plan.filter((p) => p.livraisonPrevue >= a && p.livraisonPrevue < b).length });
  }
  return {
    delivered7, due7,
    onTimePct: due28.length ? round_(100 * onTime / due28.length, 0) : null,
    dueCount28: due28.length, onTimeCount28: onTime,
    lateLots: late,
    leadTimeH: lt.length ? round_(lt.reduce((x, y) => x + y, 0) / lt.length, 1) : null,
    leadTimeStdH: round_(line.reduce((x, p) => x + p.stdH, 0), 1),
    weekly,
  };
}

// ------------------------------------------------------------------ aléas

/** Pareto des aléas depuis `since`, par `key` ("categorie" ou "poste"), en minutes d'arrêt. */
function paretoAleas_(aleas, since, key) {
  const agg = {};
  aleas.filter((a) => a.date >= since).forEach((a) => {
    const k = a[key] || 'Non renseigné';
    agg[k] = agg[k] || { key: k, count: 0, minutes: 0 };
    agg[k].count += 1;
    agg[k].minutes += Number(a.arretMin) || 0;
  });
  const rows = Object.keys(agg).map((k) => agg[k]).sort((x, y) => y.minutes - x.minutes || y.count - x.count);
  const total = rows.reduce((x, r) => x + r.minutes, 0);
  let cum = 0;
  rows.forEach((r) => {
    cum += r.minutes;
    r.pct = total ? round_(100 * r.minutes / total, 1) : 0;
    r.cumPct = total ? round_(100 * cum / total, 1) : 0;
  });
  return rows;
}

/**
 * Aléas récurrents : même poste et même catégorie, au moins MIN_COUNT fois sur WINDOW_DAYS jours.
 * Une récurrence sans action durable renseignée est une alerte prioritaire.
 */
function detectRecurrence_(aleas, now, opts) {
  const o = Object.assign({}, CC.RECURRENCE, opts || {});
  const since = addDays_(now, -o.WINDOW_DAYS);
  const groups = {};
  aleas.filter((a) => a.date > since && a.date <= now).forEach((a) => {
    const k = a.poste + '|' + a.categorie;
    groups[k] = groups[k] || [];
    groups[k].push(a);
  });
  const d14 = addDays_(now, -14);
  const d28 = addDays_(now, -28);
  const res = [];
  Object.keys(groups).forEach((k) => {
    const g = groups[k];
    if (g.length < o.MIN_COUNT) return;
    const [poste, categorie] = k.split('|');
    const same = aleas.filter((a) => a.poste === poste && a.categorie === categorie);
    const last14 = same.filter((a) => a.date > d14 && a.date <= now).length;
    const prev14 = same.filter((a) => a.date > d28 && a.date <= d14).length;
    const durable = g.filter((a) => String(a.durable || '').trim() !== '');
    const minutes = g.reduce((x, a) => x + (Number(a.arretMin) || 0), 0);
    const level = durable.length === 0 && (last14 >= prev14 || g.length >= 2 * o.MIN_COUNT) ? 'critical'
      : durable.length === 0 ? 'serious' : 'warning';
    res.push({ poste, categorie, count: g.length, minutes, last14, prev14,
      trend: last14 > prev14 ? 'hausse' : last14 < prev14 ? 'baisse' : 'stable',
      hasDurable: durable.length > 0, durable: durable.length ? durable[durable.length - 1].durable : '',
      level, lastDescription: g[g.length - 1].description });
  });
  const rank = { critical: 0, serious: 1, warning: 2 };
  return res.sort((a, b) => rank[a.level] - rank[b.level] || b.minutes - a.minutes);
}

/** Classement d'un aléa à partir de sa description (règles par mots-clés, utilisées sans clé Gemini). */
function classifyAleaRules_(text) {
  const t = String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const rules = [
    ['Moyen de mesure', ['etalonn', 'micrometre', 'pied a coulisse', 'comparateur', 'cle dynamo', 'jauge', 'instrument', 'metrolog']],
    ['Outillage', ['foret', 'effecteur', 'outil', 'riveteuse', 'gabarit', 'perceuse', 'usure', 'casse']],
    ['Manque pièce', ['manque', 'rupture', 'pas recu', 'non livre', 'appro', 'fournisseur', 'kit incomplet']],
    ['Non-conformité', ['non conform', 'non-conform', 'hors tolerance', 'defaut', 'rayure', 'derogation', 'reprise']],
    ['Documentation', ['gamme', 'plan', 'instruction', 'document', 'indice', 'fiche']],
    ['Main-d\'œuvre', ['absent', 'effectif', 'habilitation', 'formation', 'remplacant', 'personnel']],
  ];
  let best = null;
  rules.forEach(([cat, words]) => {
    const score = words.filter((w) => t.indexOf(w) >= 0).length;
    if (score > 0 && (!best || score > best.score)) best = { categorie: cat, score };
  });
  return best ? { categorie: best.categorie, source: 'règles', confidence: best.score >= 2 ? 'élevée' : 'moyenne' }
    : { categorie: '', source: 'règles', confidence: 'aucune' };
}

/** Minutes d'arrêt par semaine et par catégorie, sur `weeks` semaines. */
function weeklyAleas_(aleas, now, weeks) {
  const w0 = mondayOf_(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const a = addDays_(w0, -7 * i);
    const b = addDays_(a, 7);
    const row = { week: isoWeekLabel_(a), total: 0 };
    CC.ALEA_CATEGORIES.forEach((c) => { row[c] = 0; });
    aleas.filter((x) => x.date >= a && x.date < b && x.date <= now).forEach((x) => {
      const m = Number(x.arretMin) || 0;
      if (row[x.categorie] !== undefined) row[x.categorie] += m;
      row.total += m;
    });
    out.push(row);
  }
  return out;
}

// ------------------------------------------------------------------ métrologie

function parseHistory_(h) {
  return String(h || '').split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter((x) => x === 'C' || x === 'NC');
}

/** Statut de chaque instrument et proposition de périodicité. */
function metrologyStatus_(instruments, now) {
  const M = CC.METRO;
  return instruments.map((ins) => {
    const last = toDate_(ins.dernierEtalonnage);
    const period = Number(ins.periodiciteJ) || 365;
    const ref = Number(ins.periodiciteRefJ) || period;
    const due = last ? addDays_(last, period) : now;
    const daysLeft = Math.floor(daysBetween_(startOfDay_(now), startOfDay_(due)));
    const status = daysLeft < 0 ? 'En retard' : daysLeft <= M.PLAN_AHEAD_DAYS ? 'À planifier' : 'Valide';
    const hist = parseHistory_(ins.historique);
    let suggested = period;
    let reason = 'Périodicité maintenue';
    if (hist.length && hist[hist.length - 1] === 'NC') {
      suggested = Math.max(M.MIN_INTERVAL_DAYS, Math.round(period * M.SHORTEN_FACTOR));
      reason = 'Dernier étalonnage non conforme : périodicité raccourcie';
    } else if (hist.length >= M.STABLE_RUN && hist.slice(-M.STABLE_RUN).every((x) => x === 'C') && hist.indexOf('NC') < 0) {
      suggested = Math.min(Math.round(ref * M.MAX_INTERVAL_FACTOR), Math.round(period * M.EXTEND_FACTOR));
      reason = suggested > period ? M.STABLE_RUN + ' résultats conformes consécutifs : périodicité allongeable'
        : 'Périodicité déjà au maximum autorisé';
    }
    return Object.assign({}, ins, { dueDate: due, daysLeft, status, suggestedJ: suggested, reason,
      level: status === 'En retard' ? 'critical' : status === 'À planifier' ? 'warning' : 'good' });
  });
}

/**
 * Charge d'étalonnage par semaine et lissage : on n'avance un étalonnage que vers une semaine plus tôt
 * (jamais après son échéance), en partant des semaines les plus chargées.
 */
function levelCalibrations_(status, now, weeks, capacity) {
  const w0 = mondayOf_(now);
  const n = weeks || CC.METRO.LOAD_WEEKS;
  const weekOf = (d) => Math.floor(daysBetween_(w0, startOfDay_(d)) / 7);
  const items = status.map((s) => ({ id: s.id, poste: s.poste, designation: s.designation,
    week: Math.max(0, weekOf(s.dueDate)) })).filter((x) => x.week < n);
  const load = new Array(n).fill(0);
  items.forEach((x) => { load[x.week] += 1; });
  const cap = capacity || Math.max(1, Math.ceil(items.length / n));
  const leveled = load.slice();
  const moves = [];
  for (let w = n - 1; w >= 0; w -= 1) {
    let k = w - 1;
    while (leveled[w] > cap && k >= 0) {
      if (leveled[k] < cap) {
        const it = items.find((x) => x.week === w && !x.moved);
        if (!it) break;
        it.moved = true;
        it.newWeek = k;
        leveled[w] -= 1;
        leveled[k] += 1;
        moves.push({ id: it.id, designation: it.designation, poste: it.poste,
          from: isoWeekLabel_(addDays_(w0, 7 * w)), to: isoWeekLabel_(addDays_(w0, 7 * k)) });
      } else k -= 1;
    }
  }
  const labels = load.map((_, i) => isoWeekLabel_(addDays_(w0, 7 * i)));
  return { labels, load, leveled, capacity: cap, moves, peakBefore: Math.max.apply(null, load),
    peakAfter: Math.max.apply(null, leveled) };
}

// ------------------------------------------------------------------ 5S

function fiveS_(audits, line) {
  return line.map((p) => {
    const rows = audits.filter((a) => a.poste === p.code).sort((a, b) => a.semaine - b.semaine);
    const score = (r) => round_(100 * ['s1', 's2', 's3', 's4', 's5'].reduce((x, k) => x + (Number(r[k]) || 0), 0) / 25, 0);
    const scores = rows.map(score);
    const lastScore = scores.length ? scores[scores.length - 1] : null;
    const prev = scores.length > 1 ? scores[scores.length - 2] : null;
    const weakest = rows.length ? ['s1', 's2', 's3', 's4', 's5'].reduce((a, k) =>
      (Number(rows[rows.length - 1][k]) < Number(rows[rows.length - 1][a]) ? k : a), 's1') : null;
    const names = { s1: 'Débarrasser', s2: 'Ranger', s3: 'Nettoyer', s4: 'Standardiser', s5: 'Maintenir' };
    return { code: p.code, name: p.name, score: lastScore, delta: prev === null ? null : lastScore - prev,
      history: scores, weakest: weakest ? names[weakest] : '' };
  });
}

// ------------------------------------------------------------------ synthèse

function buildKpis_(data, now) {
  const line = CC.LINE;
  const wip = computeWip_(data.moves, now, line);
  const flow = flowKpis_(data.plan, data.moves, now, line);
  const d7 = addDays_(now, -7);
  const d28 = addDays_(now, -28);
  const aleas7 = data.aleas.filter((a) => a.date > d7 && a.date <= now);
  const metro = metrologyStatus_(data.instruments, now);
  const level = levelCalibrations_(metro, now);
  const recur = detectRecurrence_(data.aleas, now);
  const times = stationTimes_(data.moves, addDays_(now, -14), line);
  const bottleneck = wip.slice().sort((a, b) => b.queue - a.queue || b.oldestQueueH - a.oldestQueueH)[0];
  return {
    generatedAt: now,
    line: line.map((p) => ({ code: p.code, name: p.name })),
    wip, times,
    wipTotal: wip.reduce((x, s) => x + s.total, 0),
    bottleneck: bottleneck && bottleneck.queue > 0 ? { code: bottleneck.code, name: bottleneck.name, queue: bottleneck.queue } : null,
    wipHistory: wipHistory_(data.moves, now, 20, line.map((p) => p.code)),
    flow,
    aleas: {
      count7: aleas7.length,
      stopH7: round_(aleas7.reduce((x, a) => x + (Number(a.arretMin) || 0), 0) / 60, 1),
      open: data.aleas.filter((a) => a.statut !== 'Clos').length,
      withDurablePct: data.aleas.filter((a) => a.date > d28).length
        ? round_(100 * data.aleas.filter((a) => a.date > d28 && String(a.durable || '').trim()).length
          / data.aleas.filter((a) => a.date > d28).length, 0) : null,
      paretoCategorie: paretoAleas_(data.aleas, d28, 'categorie'),
      paretoPoste: paretoAleas_(data.aleas, d28, 'poste'),
      recurrences: recur,
      weekly: weeklyAleas_(data.aleas, now, 8),
    },
    metro: {
      total: metro.length,
      late: metro.filter((m) => m.status === 'En retard'),
      toPlan: metro.filter((m) => m.status === 'À planifier').sort((a, b) => a.daysLeft - b.daysLeft),
      valid: metro.filter((m) => m.status === 'Valide').length,
      extend: metro.filter((m) => m.suggestedJ > Number(m.periodiciteJ)).length,
      shorten: metro.filter((m) => m.suggestedJ < Number(m.periodiciteJ)).length,
      blockedPostes: Array.from(new Set(metro.filter((m) => m.status === 'En retard').map((m) => m.poste))).sort(),
      leveling: level,
      list: metro,
    },
    fiveS: fiveS_(data.audits, line),
  };
}

/** Faits chiffrés transmis à l'IA : uniquement ce que le cockpit a calculé. */
function briefFacts_(k) {
  return {
    date: fmtDate_(k.generatedAt),
    livraisons_7j: k.flow.delivered7, livraisons_prevues_7j: k.flow.due7,
    respect_plan_28j_pct: k.flow.onTimePct, lots_en_retard: k.flow.lateLots.length,
    encours_total: k.wipTotal,
    goulot: k.bottleneck ? k.bottleneck.code + ' ' + k.bottleneck.name + ' (' + k.bottleneck.queue + ' lots en file)' : 'aucun',
    temps_traversee_h: k.flow.leadTimeH, temps_traversee_standard_h: k.flow.leadTimeStdH,
    aleas_7j: k.aleas.count7, heures_arret_7j: k.aleas.stopH7,
    recurrences: k.aleas.recurrences.slice(0, 3).map((r) => ({ poste: r.poste, categorie: r.categorie, nombre: r.count,
      minutes: r.minutes, action_durable: r.hasDurable ? r.durable : 'aucune' })),
    instruments_en_retard: k.metro.late.map((m) => m.id + ' (' + m.designation + ', ' + m.poste + ', ' + (-m.daysLeft) + ' j de retard)'),
    instruments_a_planifier_30j: k.metro.toPlan.length,
    score_5s_min: k.fiveS.slice().sort((a, b) => a.score - b.score)[0],
  };
}

/** Brief rédigé sans IA, à partir des mêmes faits. Sert de secours et de référence. */
function briefFallback_(k) {
  const f = briefFacts_(k);
  const lines = [];
  lines.push('Point production du ' + f.date + '.');
  lines.push('Sécurité et qualité : ' + (f.instruments_en_retard.length
    ? f.instruments_en_retard.length + ' instrument(s) de mesure en retard d\'étalonnage (' + f.instruments_en_retard.join(' ; ') + ') : à retirer du poste avant la prochaine mesure.'
    : 'aucun instrument de mesure en retard d\'étalonnage.'));
  lines.push('Livraisons : ' + f.livraisons_7j + ' lots livrés sur 7 jours pour ' + f.livraisons_prevues_7j
    + ' prévus ; respect du plan sur 28 jours : ' + f.respect_plan_28j_pct + ' %.');
  lines.push('Encours : ' + f.encours_total + ' lots sur la ligne ; goulot : ' + f.goulot + '.');
  if (f.recurrences.length) {
    const r = f.recurrences[0];
    lines.push('Aléa prioritaire : ' + r.categorie + ' au poste ' + r.poste + ', ' + r.nombre + ' fois en '
      + CC.RECURRENCE.WINDOW_DAYS + ' jours (' + r.minutes + ' min d\'arrêt), action durable : ' + r.action_durable + '.');
  }
  lines.push('Aléas sur 7 jours : ' + f.aleas_7j + ', soit ' + fmtNum_(f.heures_arret_7j) + ' h d\'arrêt.');
  if (f.score_5s_min) lines.push('5S : score le plus bas au poste ' + f.score_5s_min.code + ' (' + f.score_5s_min.score + ' %), point faible : ' + f.score_5s_min.weakest + '.');
  return lines.join('\n');
}

/**
 * Contrôle des chiffres d'un texte généré : chaque nombre cité doit exister dans les faits.
 * Renvoie la liste des nombres inventés (vide si tout est vérifiable).
 */
function unverifiedNumbers_(text, facts) {
  const known = new Set();
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'number') { known.add(String(v)); known.add(String(v).replace('.', ',')); return; }
    if (typeof v === 'string') { (v.match(/\d+(?:[.,]\d+)?/g) || []).forEach((n) => { known.add(n); known.add(n.replace('.', ',')); known.add(n.replace(',', '.')); }); return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof v === 'object') Object.keys(v).forEach((x) => walk(v[x]));
  };
  walk(facts);
  [String(CC.RECURRENCE.WINDOW_DAYS), '7', '28', '30', '5'].forEach((n) => known.add(n));
  // Les codes (P30, MIC-5003, B-0412) ne sont pas des chiffres à vérifier.
  const cleaned = String(text).replace(/\b[A-Z]{1,4}-?\d+\b/g, ' ');
  const found = cleaned.match(/\d+(?:[.,]\d+)?/g) || [];
  return Array.from(new Set(found.filter((n) => !known.has(n))));
}
