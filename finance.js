/* ============================================================
   PlexCompare — moteur financier
   Volontairement pur : aucune dépendance au DOM ni à chrome.*.
   Chargé par le content script, le tableau de bord et tests.html.
   ============================================================ */

var PC = (() => {
  "use strict";

  // ---------- Barèmes officiels ----------

  // Droits sur les mutations immobilières — grille en vigueur au 1er janvier 2026.
  // Les deux premiers seuils sont indexés chaque année par Québec ; les paliers
  // supérieurs sont propres à Montréal et fixés par règlement municipal.
  // Vérifié contre l'exemple officiel de la Ville : 700 000 $ → 9 349,00 $.
  const ANNEE_MUTATION = 2026;

  const PALIERS_QC = [
    [62900, 0.005],
    [315000, 0.01],
    [Infinity, 0.015]
  ];

  const PALIERS_MTL = [
    [62900, 0.005],
    [315000, 0.01],
    [552300, 0.015],
    [1104700, 0.02],
    [2136500, 0.025],
    [3113000, 0.035],
    [Infinity, 0.04]
  ];

  // Primes SCHL — propriétaire-occupant, immeubles de 1 à 4 logements.
  // Le même barème s'applique du unifamilial au quadruplex : il n'y a pas
  // de tarif « plex » distinct tant que vous occupez une des unités.
  // [rapport prêt-valeur maximal, taux de prime]
  const SCHL_OCCUPANT = [
    [0.65, 0.006],
    [0.75, 0.017],
    [0.80, 0.024],
    [0.85, 0.028],
    [0.90, 0.031],
    [0.95, 0.040]
  ];

  const TAXE_PRIME_QC = 0.09;          // taxe provinciale sur la prime, payable comptant
  const SURPRIME_AMORT_PROLONGE = 0.002; // + 0,20 % si amortissement > 25 ans
  const PLAFOND_ASSURABLE = 1500000;   // $ — au-delà, 20 % comptant obligatoire

  // ---------- Utilitaires de format ----------

  const parseMoney = (txt) => {
    if (txt === 0) return 0;
    if (!txt) return null;
    const m = String(txt).replace(/[   ]/g, " ").match(/(-?[\d\s.,]+)\s*\$?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  };

  const fmt = (n, dec = 0) =>
    n === null || n === undefined || !isFinite(n)
      ? "—"
      : n.toLocaleString("fr-CA", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " $";

  const fmtPct = (n, dec = 2) =>
    n === null || n === undefined || !isFinite(n)
      ? "—"
      : n.toLocaleString("fr-CA", { maximumFractionDigits: dec });

  // « 1 x 3 ½, 2 x 5 ½ » → [5.5, 5.5, 3.5] (trié décroissant)
  function parseUnites(txt) {
    if (!txt) return null;
    const unites = [];
    const re = /(\d+)\s*x\s*(\d+)\s*(½)?/g;
    let m;
    while ((m = re.exec(txt))) {
      const nb = parseInt(m[1], 10);
      const taille = parseInt(m[2], 10) + (m[3] ? 0.5 : 0);
      if (nb > 0 && nb <= 8 && taille >= 1 && taille <= 15) {
        for (let i = 0; i < nb; i++) unites.push(taille);
      }
    }
    return unites.length ? unites.sort((a, b) => b - a) : null;
  }

  // 5.5 → « 5½ », 3 → « 3 »
  function libelleTaille(t) {
    if (!(t > 1)) return "unité";
    return Number.isInteger(t) ? String(t) : Math.floor(t) + "½";
  }

  // ---------- Calculs financiers ----------

  // Paiement hypothécaire canadien (intérêt composé semi-annuellement)
  function paiementMensuel(principal, tauxAnnuelPct, annees) {
    if (!principal || !annees) return 0;
    if (!tauxAnnuelPct) return principal / (annees * 12);
    const rMois = Math.pow(1 + tauxAnnuelPct / 100 / 2, 2 / 12) - 1;
    const n = annees * 12;
    return (principal * rMois) / (1 - Math.pow(1 + rMois, -n));
  }

  // Mise de fonds minimale exigée
  //   Propriétaire-occupant, 1-2 logements : 5 % sur les premiers 500 000 $,
  //     10 % sur l'excédent (assurable jusqu'à 1,5 M$)
  //   Propriétaire-occupant, 3-4 logements : 10 %
  //   Non occupant (investisseur) ou prix > plafond assurable : 20 %
  function miseDeFondsMin(prix, nbUnites, occupant = true) {
    if (!prix) return 0;
    if (!occupant || prix > PLAFOND_ASSURABLE) return prix * 0.20;
    if (nbUnites >= 3) return prix * 0.10;
    if (prix <= 500000) return prix * 0.05;
    return 500000 * 0.05 + (prix - 500000) * 0.10;
  }

  // Prime SCHL selon le rapport prêt-valeur, + taxe QC de 9 % payable comptant.
  // Un investisseur non occupant à 20 % comptant prend un prêt conventionnel
  // non assuré : aucune prime.
  function primeSCHL(prix, miseDeFonds, occupant = true, amortissement = 25) {
    const vide = { prime: 0, taxePrime: 0, tauxPrime: 0, ltv: 0 };
    if (!prix || prix <= 0) return vide;

    const pret = prix - miseDeFonds;
    if (pret <= 0) return vide;

    const ltv = pret / prix;
    // Assurance non requise à 20 % comptant ou plus, et impossible au-delà
    // du plafond assurable ou pour un immeuble non occupé par le propriétaire.
    if (ltv <= 0.80 || !occupant || prix > PLAFOND_ASSURABLE) {
      return { ...vide, ltv };
    }

    let taux = 0;
    for (const [ltvMax, t] of SCHL_OCCUPANT) {
      if (ltv <= ltvMax) { taux = t; break; }
    }
    if (!taux) taux = SCHL_OCCUPANT[SCHL_OCCUPANT.length - 1][1];
    if (amortissement > 25) taux += SURPRIME_AMORT_PROLONGE;

    const prime = pret * taux;
    return { prime, taxePrime: prime * TAXE_PRIME_QC, tauxPrime: taux, ltv };
  }

  // Droits de mutation (« taxe de bienvenue »)
  function taxeBienvenue(prix, montreal) {
    if (!prix || prix <= 0) return 0;
    const paliers = montreal ? PALIERS_MTL : PALIERS_QC;
    let total = 0, bas = 0;
    for (const [haut, taux] of paliers) {
      if (prix <= bas) break;
      total += (Math.min(prix, haut) - bas) * taux;
      bas = haut;
    }
    return total;
  }

  /**
   * Calcul complet.
   * @param d        intrants de la fiche (prix, revenus, taxes, unités…)
   * @param settings hypothèses de l'utilisateur (voir PC_DEFAULTS)
   * @param scen     scénarios actifs : {stress, mdf20, marche, invest}
   */
  function calculer(d, settings, scen) {
    d = d || {};
    settings = settings || {};
    scen = scen || {};

    const prix = d.prix || 0;
    const nbUnites = d.nbUnites || 2;
    const occupant = !scen.invest;

    const revenusLoyers = (scen.marche && d.revenusMarche ? d.revenusMarche : d.revenusAn) || 0;
    const autresRevenusAn = d.autresRevenusAn || 0;
    const revenusAn = revenusLoyers + autresRevenusAn;

    const tauxEffectif = (settings.tauxHypo || 0) + (scen.stress ? 1.5 : 0);
    const amort = settings.amortissement || 25;

    // --- Financement ---
    const mdfMin = miseDeFondsMin(prix, nbUnites, occupant);
    let mdf = d.miseDeFonds != null ? d.miseDeFonds : mdfMin;
    if (scen.mdf20 && d.miseDeFonds == null) mdf = prix * 0.20;
    mdf = Math.min(Math.max(mdf, 0), prix);

    const { prime, taxePrime, tauxPrime } = primeSCHL(prix, mdf, occupant, amort);
    const pret = Math.max(prix - mdf + prime, 0); // la prime est ajoutée au prêt
    const hypo = paiementMensuel(pret, tauxEffectif, amort);

    // --- Répartition des loyers au prorata de la taille des logements ---
    // Un 5½ rapporte plus qu'un 3½. Par défaut vous occupez le plus grand,
    // donc les loyers perçus sont ceux des plus petites unités.
    const unites = parseUnites(d.unitesDetail) ||
      Array.from({ length: nbUnites }, () => 1); // tailles inconnues → parts égales
    const sommePoids = unites.reduce((a, b) => a + b, 0);
    const revenusMois = revenusLoyers / 12;
    const repartition = unites.map((taille, i) => ({
      taille,
      libelle: libelleTaille(taille),
      loyer: sommePoids ? (revenusMois * taille) / sommePoids : 0,
      occupe: occupant && i === 0 // trié décroissant : la plus grande = la vôtre
    }));

    const loyerOccupeEstime = d.loyerOccupe == null;
    let loyerOccupe = 0;
    if (occupant) {
      loyerOccupe = loyerOccupeEstime
        ? (repartition.length ? repartition[0].loyer : 0)
        : d.loyerOccupe;
    }
    const loyersPercusMois = Math.max(0, revenusMois - loyerOccupe) + autresRevenusAn / 12;

    // --- Dépenses ---
    const taxesAn = (d.taxeMuni || 0) + (d.taxeScol || 0);
    // L'entretien porte sur tout l'immeuble, y compris votre logement.
    const entretienAn = revenusAn * ((settings.entretienPct || 0) / 100);
    const fixesAn = taxesAn + entretienAn +
      (settings.assurancesAn || 0) + (settings.deneigementAn || 0);

    // La vacance ne s'applique qu'aux logements réellement loués : vous ne
    // « perdez » pas de loyer sur l'unité que vous habitez.
    const vacancePct = (settings.vacancePct || 0) / 100;
    const vacanceInvAn = revenusAn * vacancePct;
    const vacanceOccAn = loyersPercusMois * 12 * vacancePct;

    const depensesInvAn = fixesAn + vacanceInvAn; // toutes les unités louées
    const depensesOccAn = fixesAn + vacanceOccAn; // vous habitez une unité

    // --- Deux lectures du même immeuble ---
    const cashflowMois = revenusAn / 12 - hypo - depensesInvAn / 12;
    const coutHabitation = occupant
      ? hypo + depensesOccAn / 12 - loyersPercusMois
      : -cashflowMois;

    // --- Indicateurs ---
    const mrb = revenusAn > 0 ? prix / revenusAn : null;
    const noiAn = revenusAn - depensesInvAn;
    const capRate = prix > 0 ? (noiAn / prix) * 100 : null;
    const serviceDetteAn = hypo * 12;
    // DSCR : couverture de la dette — les prêteurs exigent ≥ 1,10 à 1,25 en locatif
    const dscr = serviceDetteAn > 0 ? noiAn / serviceDetteAn : null;
    const prixParPorte = nbUnites > 0 ? prix / nbUnites : null;
    const loyerMoyenPorte = revenusLoyers && nbUnites ? revenusLoyers / 12 / nbUnites : null;

    // --- Cash requis à la clôture ---
    const bienvenue = taxeBienvenue(prix, settings.villeMontreal);
    const travaux = d.travaux || 0;
    const fraisNotaire = settings.fraisNotaire || 0;
    const fraisInspection = settings.fraisInspection || 0;
    const fondsDemarrage = settings.fondsDemarrage || 0;
    const cashCloture = mdf + bienvenue + taxePrime + fraisNotaire + fraisInspection;
    const cashTotal = cashCloture + travaux + fondsDemarrage;

    // Cash-on-cash : rendement annuel du cashflow sur l'argent réellement sorti
    const cashOnCash = cashTotal > 0 ? ((cashflowMois * 12) / cashTotal) * 100 : null;

    return {
      // intrants normalisés
      prix, nbUnites, revenusAn, revenusLoyers, autresRevenusAn, occupant,
      // financement
      mdf, mdfMin, prime, taxePrime, tauxPrime, pret, hypo, tauxEffectif, amort,
      // exploitation
      taxesAn, entretienAn, vacanceInvAn, vacanceOccAn,
      depensesInvAn, depensesOccAn, noiAn,
      // résultats
      cashflowMois, coutHabitation, loyersPercusMois, loyerOccupe,
      loyerOccupeEstime, repartition,
      // indicateurs
      mrb, capRate, dscr, prixParPorte, loyerMoyenPorte, cashOnCash,
      // clôture
      bienvenue, fraisNotaire, fraisInspection, fondsDemarrage, travaux,
      cashCloture, cashTotal
    };
  }

  return {
    ANNEE_MUTATION, PLAFOND_ASSURABLE,
    parseMoney, fmt, fmtPct, parseUnites, libelleTaille,
    paiementMensuel, miseDeFondsMin, primeSCHL, taxeBienvenue, calculer
  };
})();

if (typeof window !== "undefined") window.PC = PC;
