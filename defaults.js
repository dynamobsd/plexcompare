/* ============================================================
   PlexCompare — hypothèses par défaut
   Source unique de vérité : chargé par le content script, le popup
   ET le tableau de bord. Ne jamais redéfinir ces valeurs ailleurs.
   ============================================================ */

var PC_DEFAULTS = {
  // --- Financement ---
  tauxHypo: 4.79,        // % — taux hypothécaire annuel
  amortissement: 25,     // années (> 25 → majoration SCHL de 0,20 %)

  // --- Dépenses d'exploitation ---
  entretienPct: 5,       // % des revenus bruts
  vacancePct: 3,         // % des loyers (voir note dans finance.js)
  assurancesAn: 3000,    // $/an (plex)
  deneigementAn: 800,    // $/an (déneigement, pelouse, divers)

  // --- Frais de clôture ---
  fraisNotaire: 2000,    // $
  fraisInspection: 800,  // $
  fondsDemarrage: 0,     // $ — coussin de départ souhaité

  // --- Contexte ---
  loyerUniteOccupee: 0,  // $/mois — valeur locative de VOTRE unité (0 = estimer)
  villeMontreal: true,   // droits de mutation : paliers additionnels de Montréal
  sheetUrl: "",          // URL du script Google Apps (liste partagée)

  // --- Interface (mémorisé, pas un réglage du popup) ---
  panneauReplie: false
};

// Réglages exposés dans le popup, dans l'ordre d'affichage.
var PC_CHAMPS_POPUP = [
  "tauxHypo", "amortissement", "entretienPct", "vacancePct",
  "assurancesAn", "deneigementAn", "fraisNotaire", "fraisInspection",
  "fondsDemarrage", "loyerUniteOccupee", "villeMontreal", "sheetUrl"
];

if (typeof window !== "undefined") {
  window.PC_DEFAULTS = PC_DEFAULTS;
  window.PC_CHAMPS_POPUP = PC_CHAMPS_POPUP;
}
