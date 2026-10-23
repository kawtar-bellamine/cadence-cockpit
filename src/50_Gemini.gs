/**
 * Intégration de Gemini, avec des garde-fous :
 *  - la clé est lue dans les propriétés du script, jamais écrite dans la feuille ;
 *  - l'IA ne reçoit que les faits calculés par le cockpit ;
 *  - chaque chiffre du texte généré est comparé aux faits ; un texte avec un chiffre inventé est rejeté ;
 *  - sans clé ou en cas d'erreur, le cockpit continue avec un modèle de texte et des règles.
 */

function geminiKey_() {
  return PropertiesService.getScriptProperties().getProperty(CC.GEMINI_KEY_PROPERTY);
}

/** Appel de l'API Gemini. Renvoie le texte, ou null si pas de clé ou échec après deux essais. */
function callGemini_(prompt, temperature) {
  const key = geminiKey_();
  if (!key) return null;
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + CC.GEMINI_MODEL + ':generateContent';
  const params = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: temperature === undefined ? 0.2 : temperature, maxOutputTokens: 1024 },
    }),
    muteHttpExceptions: true,
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = UrlFetchApp.fetch(url, params);
      const code = res.getResponseCode();
      if (code === 200) {
        const j = JSON.parse(res.getContentText());
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const text = parts.map((p) => p.text || '').join('').trim();
        return text || null;
      }
      if (code !== 429 && code < 500) return null;
    } catch (e) {
      Logger.log('Gemini : ' + e);
    }
    Utilities.sleep(1500);
  }
  return null;
}

function briefPrompt_(facts) {
  return [
    'Tu es l\'assistant d\'un responsable de ligne d\'assemblage aéronautique.',
    'Rédige le point de production du jour en français, en 6 à 8 phrases courtes, dans cet ordre :',
    'sécurité et qualité (moyens de mesure), livraisons, encours et goulot, aléa prioritaire avec action attendue, 5S.',
    'Règles strictes : utilise uniquement les faits ci-dessous ; n\'invente aucun chiffre ; si une information manque,',
    'ne la mentionne pas ; pas de titre, pas de liste à puces, pas de tiret cadratin.',
    'Faits (JSON) :',
    JSON.stringify(facts),
  ].join('\n');
}

/**
 * Génère le brief du jour. Renvoie { text, source, check }.
 * `k` est l'objet de buildKpis_ ; séparé de l'écriture dans la feuille pour être testé.
 */
function composeBrief_(k) {
  const facts = briefFacts_(k);
  const ai = callGemini_(briefPrompt_(facts));
  if (ai) {
    const bad = unverifiedNumbers_(ai, facts);
    if (!bad.length) return { text: ai, source: 'Gemini (' + CC.GEMINI_MODEL + ')', check: 'Tous les chiffres vérifiés' };
    return { text: briefFallback_(k), source: 'Modèle de texte',
      check: 'Texte Gemini rejeté : chiffre(s) absent(s) des données (' + bad.join(', ') + ')' };
  }
  return { text: briefFallback_(k), source: 'Modèle de texte',
    check: geminiKey_() ? 'Gemini indisponible, texte de secours' : 'Pas de clé Gemini configurée' };
}

/** Catégorie d'un aléa à partir de sa description : Gemini si disponible, sinon règles par mots-clés. */
function classifyAlea_(text) {
  const clean = String(text || '').slice(0, 500);
  if (!clean.trim()) return { categorie: '', source: 'aucune', confidence: 'aucune' };
  const ai = callGemini_([
    'Classe cet aléa de production dans UNE seule de ces catégories : ' + CC.ALEA_CATEGORIES.join(' | ') + '.',
    'Réponds uniquement par le nom exact de la catégorie.',
    'Aléa : « ' + clean.replace(/[«»]/g, '"') + ' »',
  ].join('\n'), 0);
  if (ai) {
    const hit = CC.ALEA_CATEGORIES.find((c) => ai.trim().replace(/[.«»"]/g, '').toLowerCase() === c.toLowerCase());
    if (hit) return { categorie: hit, source: 'Gemini', confidence: 'élevée' };
  }
  return classifyAleaRules_(clean);
}
