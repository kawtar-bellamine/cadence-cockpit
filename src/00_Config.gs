/**
 * Cadence Cockpit : configuration.
 * Tous les seuils et noms d'onglets sont ici, pour qu'un utilisateur puisse les ajuster sans toucher à la logique.
 */
const CC = Object.freeze({
  VERSION: '1.0.0',
  TIMEZONE: 'Europe/Paris',

  SHEETS: Object.freeze({
    DASHBOARD: 'Tableau de bord',
    WIP: 'Encours',
    MOVES: 'Mouvements',
    PLAN: 'Plan',
    ALEAS: 'Aléas',
    METRO: 'Métrologie',
    FIVE_S: '5S',
    BRIEF: 'Brief',
    PARAMS: 'Paramètres',
  }),

  /** Ligne simulée : six postes en flux, capacité = nombre de positions de travail. */
  LINE: Object.freeze([
    { code: 'P10', name: 'Préparation des panneaux', stdH: 7.0, capacity: 1 },
    { code: 'P20', name: 'Assemblage des cadres', stdH: 7.5, capacity: 1 },
    { code: 'P30', name: 'Perçage et rivetage', stdH: 7.0, capacity: 1 },
    { code: 'P40', name: 'Pose des équipements', stdH: 14.0, capacity: 2 },
    { code: 'P50', name: 'Contrôle dimensionnel', stdH: 5.0, capacity: 1 },
    { code: 'P60', name: 'Finition et expédition', stdH: 6.0, capacity: 1 },
  ]),

  /** Calendrier de travail : deux équipes, du lundi au vendredi. */
  SHIFT_START_HOUR: 5,
  WORK_HOURS_PER_DAY: 16,
  TAKT_H: 8, // un lot toutes les 8 heures ouvrées, soit 2 par jour
  DUE_MARGIN_H: 68, // délai planifié entre lancement et livraison, en heures ouvrées

  ALEA_CATEGORIES: Object.freeze([
    'Manque pièce', 'Outillage', 'Non-conformité', 'Moyen de mesure', 'Documentation', 'Main-d\'œuvre',
  ]),
  ALEA_STATUSES: Object.freeze(['Ouvert', 'En cours', 'Clos']),

  /** Récurrence : au moins MIN_COUNT aléas même poste + même catégorie sur WINDOW_DAYS jours. */
  RECURRENCE: Object.freeze({ WINDOW_DAYS: 21, MIN_COUNT: 3 }),

  /** Métrologie : seuils de statut et règles d'ajustement des périodicités. */
  METRO: Object.freeze({
    PLAN_AHEAD_DAYS: 30,
    STABLE_RUN: 3, // nombre de résultats conformes consécutifs pour proposer d'allonger
    EXTEND_FACTOR: 1.25,
    SHORTEN_FACTOR: 0.7,
    MIN_INTERVAL_DAYS: 30,
    MAX_INTERVAL_FACTOR: 2, // jamais plus de 2 fois la périodicité de référence du type
    LOAD_WEEKS: 12,
  }),

  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_KEY_PROPERTY: 'GEMINI_API_KEY',
  DEMO_SEED: 2027,
});
