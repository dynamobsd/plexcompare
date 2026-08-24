/**
 * PlexCompare — pont vers votre Google Sheet partagé
 *
 * INSTALLATION (5 minutes, une seule personne le fait) :
 * 1. Crée un Google Sheet vide, nomme-le « Nos plex » et partage-le
 *    avec ta conjointe (accès Éditeur).
 * 2. Dans le Sheet : Extensions → Apps Script.
 * 3. Efface le contenu, colle TOUT ce fichier, puis Enregistrer.
 * 4. Déployer → Nouveau déploiement → type « Application Web » :
 *      - Exécuter en tant que : Moi
 *      - Qui a accès : Tout le monde
 *    → Déployer, autoriser l'accès, puis copier l'URL qui se termine
 *      par /exec.
 * 5. Colle cette URL dans le popup de l'extension (champ « URL du
 *    script Google ») — sur VOS DEUX ordinateurs.
 */

const ENTETES = [
  "Date", "Adresse", "Lien Centris", "Prix", "Unités",
  "Revenus bruts/an", "Coût d'habitation/mois", "Cashflow/mois",
  "MRB", "Taux de cap %", "Hypothèque/mois", "Mise de fonds",
  "Taxe de bienvenue", "Travaux estimés", "Cash total requis",
  "Nos notes", "Note /10"
];

function doPost(e) {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // Entêtes + mise en forme au premier envoi
  if (feuille.getLastRow() === 0) {
    feuille.appendRow(ENTETES);
    feuille.getRange(1, 1, 1, ENTETES.length)
      .setFontWeight("bold")
      .setBackground("#0f2231")
      .setFontColor("#ffb454");
    feuille.setFrozenRows(1);
  }

  const d = JSON.parse(e.postData.contents);

  // Évite les doublons : si le lien existe déjà, on met la ligne à jour
  const liens = feuille.getRange(2, 3, Math.max(feuille.getLastRow() - 1, 1), 1).getValues().flat();
  const existante = liens.indexOf(d.url);

  const ligne = [
    d.date, d.adresse, d.url, d.prix, d.unites, d.revenusAn,
    d.coutHabitation, d.cashflow, d.mrb, d.capRate, d.hypo,
    d.miseDeFonds, d.bienvenue, d.travaux, d.cashTotal
  ];

  if (existante >= 0) {
    feuille.getRange(existante + 2, 1, 1, ligne.length).setValues([ligne]);
  } else {
    feuille.appendRow(ligne);
  }

  return ContentService.createTextOutput("ok");
}

/**
 * Lecture pour le tableau de bord de l'extension : renvoie toutes les
 * lignes du Sheet en JSON. Appelé automatiquement quand vous ouvrez
 * « Notre tableau de bord » depuis le popup de PlexCompare.
 */
function doGet() {
  const feuille = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const valeurs = feuille.getDataRange().getValues();
  return ContentService
    .createTextOutput(JSON.stringify(valeurs))
    .setMimeType(ContentService.MimeType.JSON);
}
