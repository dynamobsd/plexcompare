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
 *    script Google ») — sur VOS DEUX ordinateurs, puis clique
 *    « Tester la connexion ».
 *
 * APRÈS CHAQUE MODIFICATION DE CE FICHIER, il faut redéployer :
 *   Déployer → Gérer les déploiements → ✏️ Modifier
 *   → Version « Nouvelle version » → Déployer.
 */

const ENTETES = [
  "Date", "Adresse", "Lien Centris", "Prix", "Unités",
  "Revenus bruts/an", "Coût d'habitation/mois", "Cashflow/mois",
  "MRB", "Taux de cap %", "Hypothèque/mois", "Mise de fonds",
  "Taxe de bienvenue", "Travaux estimés", "Cash total requis",
  "Nos notes", "Note /10"
];

const COL_LIEN = 3;        // colonne « Lien Centris »
const COL_NOTES = 16;      // colonne « Nos notes »
const NB_COL_CALCUL = 15;  // colonnes écrites par l'extension (1 à 15)

// ---------- Réponses ----------

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- Feuille ----------

function feuille_() {
  const f = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (f.getLastRow() === 0) {
    f.appendRow(ENTETES);
    f.getRange(1, 1, 1, ENTETES.length)
      .setFontWeight("bold")
      .setBackground("#0f2231")
      .setFontColor("#ffb454");
    f.setFrozenRows(1);
  }
  return f;
}

// Deux personnes peuvent coller la même fiche avec ou sans paramètres
// d'URL : on compare sur une forme normalisée.
function normUrl_(u) {
  return String(u || "").split("?")[0].replace(/\/+$/, "").toLowerCase();
}

function trouverLigne_(f, url) {
  const n = f.getLastRow() - 1;
  if (n <= 0) return -1;
  const liens = f.getRange(2, COL_LIEN, n, 1).getValues();
  const cible = normUrl_(url);
  for (let i = 0; i < liens.length; i++) {
    if (normUrl_(liens[i][0]) === cible) return i + 2;
  }
  return -1;
}

// ---------- Écriture ----------

/**
 * Actions acceptées :
 *   upsert  — ajoute la propriété, ou met à jour la ligne existante
 *   notes   — met à jour « Nos notes » et « Note /10 »
 *   delete  — retire la propriété de la liste
 */
function doPost(e) {
  // Sans verrou, deux envois simultanés peuvent écrire sur la même ligne.
  const verrou = LockService.getScriptLock();
  try {
    verrou.waitLock(20000);
  } catch (err) {
    return json_({ ok: false, erreur: "liste occupée, réessaie dans un instant" });
  }

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return json_({ ok: false, erreur: "requête vide" });
    }
    const d = JSON.parse(e.postData.contents);
    if (!d.url) return json_({ ok: false, erreur: "lien Centris manquant" });

    const f = feuille_();
    const ligne = trouverLigne_(f, d.url);

    if (d.action === "delete") {
      if (ligne < 0) return json_({ ok: false, erreur: "propriété introuvable" });
      f.deleteRow(ligne);
      return json_({ ok: true, supprime: true });
    }

    if (d.action === "notes") {
      if (ligne < 0) return json_({ ok: false, erreur: "propriété introuvable" });
      f.getRange(ligne, COL_NOTES, 1, 2).setValues([[
        d.notes == null ? "" : d.notes,
        d.note === "" || d.note == null ? "" : Number(d.note)
      ]]);
      return json_({ ok: true, miseAJour: true });
    }

    // upsert (comportement par défaut)
    const valeurs = [
      d.date, d.adresse, d.url, d.prix, d.unites, d.revenusAn,
      d.coutHabitation, d.cashflow, d.mrb, d.capRate, d.hypo,
      d.miseDeFonds, d.bienvenue, d.travaux, d.cashTotal
    ];

    if (ligne >= 0) {
      // On n'écrit que les 15 colonnes calculées : vos notes sont préservées.
      f.getRange(ligne, 1, 1, NB_COL_CALCUL).setValues([valeurs]);
      return json_({ ok: true, miseAJour: true });
    }

    f.appendRow(valeurs);
    return json_({ ok: true, miseAJour: false });
  } catch (err) {
    return json_({ ok: false, erreur: String(err && err.message || err) });
  } finally {
    verrou.releaseLock();
  }
}

// ---------- Lecture ----------

/**
 * Renvoie toutes les lignes du Sheet en JSON, entête comprise.
 * Utilisé par le tableau de bord de l'extension.
 */
function doGet() {
  try {
    const f = feuille_();
    return json_(f.getDataRange().getValues());
  } catch (err) {
    return json_({ ok: false, erreur: String(err && err.message || err) });
  }
}
