/* ============================================================
   PlexCompare — content script
   S'injecte sur centris.ca :
   - Fiche détaillée : extrait prix, revenus, taxes, type → panneau
     de rentabilité automatique avec champs modifiables.
   - Résultats de recherche : badge MRB sur les vignettes quand les
     données sont disponibles.
   ============================================================ */

(() => {
  "use strict";

  // ---------- Hypothèses par défaut (modifiables via le popup) ----------
  const DEFAULTS = {
    tauxHypo: 4.79,        // % — taux hypothécaire annuel
    amortissement: 25,     // années
    miseDeFondsPct: null,  // null = minimum légal calculé automatiquement
    entretienPct: 5,       // % des revenus bruts
    vacancePct: 3,         // % des revenus bruts
    assurancesAn: 3000,    // $/an (plex)
    deneigementAn: 800,    // $/an (déneigement, pelouse, divers)
    loyerUniteOccupee: 0,  // $ /mois — valeur locative de VOTRE unité (0 = inconnue)
    villeMontreal: true,   // droits de mutation : paliers additionnels de Montréal
    sheetUrl: ""           // URL du script Google Apps (liste partagée)
  };

  let settings = { ...DEFAULTS };

  // Scénarios « Et si? » activables dans le panneau
  let scen = { stress: false, mdf20: false, marche: false };

  // ---------- Utilitaires ----------
  const parseMoney = (txt) => {
    if (!txt) return null;
    const m = String(txt).replace(/\u00a0|\u202f/g, " ").match(/([\d\s.,]+)\s*\$?/);
    if (!m) return null;
    const n = parseFloat(m[1].replace(/\s/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  };

  const fmt = (n, dec = 0) =>
    n === null || !isFinite(n)
      ? "—"
      : n.toLocaleString("fr-CA", { minimumFractionDigits: dec, maximumFractionDigits: dec }) + " $";

  const fmtPct = (n, dec = 2) =>
    n === null || !isFinite(n) ? "—" : n.toLocaleString("fr-CA", { maximumFractionDigits: dec });

  // « 1 x 3 ½, 2 x 5 ½ » → [3.5, 5.5, 5.5] (tailles de chaque logement)
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

  // ---------- Calculs financiers ----------

  // Paiement hypothécaire canadien (composition semi-annuelle)
  function paiementMensuel(principal, tauxAnnuelPct, annees) {
    if (!principal || !tauxAnnuelPct) return 0;
    const i = tauxAnnuelPct / 100;
    const rMois = Math.pow(1 + i / 2, 2 / 12) - 1;
    const n = annees * 12;
    return (principal * rMois) / (1 - Math.pow(1 + rMois, -n));
  }

  // Mise de fonds minimale (propriétaire-occupant)
  // 1-2 logements : 5 % sur les premiers 500 000 $, 10 % sur l'excédent (assurable jusqu'à 1,5 M$)
  // 3-4 logements : 10 % ; 20 % si le prix dépasse le plafond assurable
  function miseDeFondsMin(prix, nbUnites) {
    if (prix > 1500000) return prix * 0.20;
    if (nbUnites >= 3) return prix * 0.10;
    if (prix <= 500000) return prix * 0.05;
    return 500000 * 0.05 + (prix - 500000) * 0.10;
  }

  // Prime SCHL selon le ratio prêt/valeur, + taxe QC 9 % payable comptant
  function primeSCHL(prix, miseDeFonds) {
    const pret = prix - miseDeFonds;
    const ltv = pret / prix;
    let taux = 0;
    if (ltv > 0.90) taux = 0.04;
    else if (ltv > 0.85) taux = 0.031;
    else if (ltv > 0.80) taux = 0.028;
    const prime = pret * taux;
    return { prime, taxePrime: prime * 0.09 };
  }

  // Droits de mutation (« taxe de bienvenue ») — paliers approx. 2025.
  // Base provinciale + paliers additionnels de Montréal. Les seuils sont
  // indexés chaque année : à ajuster au besoin dans ce tableau.
  function taxeBienvenue(prix, montreal) {
    const paliersBase = [
      [61500, 0.005],
      [307800, 0.01],
      [Infinity, 0.015]
    ];
    const paliersMtl = [
      [61500, 0.005],
      [307800, 0.01],
      [552300, 0.015],
      [1104700, 0.02],
      [2136500, 0.025],
      [3113000, 0.035],
      [Infinity, 0.04]
    ];
    const paliers = montreal ? paliersMtl : paliersBase;
    let total = 0, bas = 0;
    for (const [haut, taux] of paliers) {
      if (prix <= bas) break;
      total += (Math.min(prix, haut) - bas) * taux;
      bas = haut;
    }
    return total;
  }

  // Calcul complet à partir des intrants du panneau (+ scénarios actifs)
  function calculer(d) {
    const prix = d.prix || 0;
    const revenusAn =
      scen.marche && d.revenusMarche ? d.revenusMarche : d.revenusAn || 0;
    const nbUnites = d.nbUnites || 2;
    const tauxEffectif = settings.tauxHypo + (scen.stress ? 1.5 : 0);

    const mdfMin = miseDeFondsMin(prix, nbUnites);
    let mdf = d.miseDeFonds != null ? d.miseDeFonds : mdfMin;
    if (scen.mdf20 && d.miseDeFonds == null) mdf = prix * 0.2;
    const { prime, taxePrime } = primeSCHL(prix, mdf);
    const pret = prix - mdf + prime; // prime ajoutée au prêt
    const hypo = paiementMensuel(pret, tauxEffectif, settings.amortissement);

    const taxesAn = (d.taxeMuni || 0) + (d.taxeScol || 0);
    const entretienAn = revenusAn * (settings.entretienPct / 100);
    const vacanceAn = revenusAn * (settings.vacancePct / 100);
    const depensesAn = taxesAn + entretienAn + vacanceAn + settings.assurancesAn + settings.deneigementAn;

    // --- Scénario investisseur : toutes les unités louées ---
    const cashflowMois = revenusAn / 12 - hypo - depensesAn / 12;

    // --- Scénario proprio-occupant (PAR DÉFAUT : vous habitez une unité) ---
    // Répartition des loyers au prorata de la TAILLE de chaque logement
    // (un 5½ rapporte plus qu'un 3½). Par défaut, VOUS prenez le plus grand :
    // les loyers perçus sont donc ceux des plus petites unités.
    const unites = parseUnites(d.unitesDetail) ||
      Array.from({ length: nbUnites }, () => 1); // tailles inconnues → parts égales
    const sommePoids = unites.reduce((a, b) => a + b, 0);
    const revenusMois = revenusAn / 12;
    const repartition = unites.map((taille, i) => ({
      taille,
      loyer: sommePoids ? (revenusMois * taille) / sommePoids : 0,
      occupe: i === 0 // trié décroissant : la plus grande d'abord = la vôtre
    }));

    const loyerOccupeEstime = d.loyerOccupe == null;
    const loyerOccupe = !loyerOccupeEstime
      ? d.loyerOccupe
      : repartition.length ? repartition[0].loyer : 0;
    const loyersPercusMois = Math.max(0, revenusMois - loyerOccupe);
    const coutHabitation = hypo + depensesAn / 12 - loyersPercusMois;

    // --- Indicateurs ---
    const mrb = revenusAn > 0 ? prix / revenusAn : null;
    const noiAn = revenusAn - depensesAn;
    const capRate = prix > 0 ? (noiAn / prix) * 100 : null;

    // --- Ratios professionnels ---
    const serviceDetteAn = hypo * 12;
    // DSCR : ratio de couverture de la dette — les banques exigent ≥ 1,10-1,25 en locatif
    const dscr = serviceDetteAn > 0 ? noiAn / serviceDetteAn : null;
    const prixParPorte = nbUnites > 0 ? prix / nbUnites : null;

    // --- Cash requis à la clôture ---
    const bienvenue = taxeBienvenue(prix, settings.villeMontreal);
    const travaux = d.travaux || 0;
    const fraisNotaire = 2000; // estimé
    const cashClotures = mdf + bienvenue + taxePrime + fraisNotaire;
    const cashTotal = cashClotures + travaux;

    // Cash-on-cash : rendement annuel du cashflow sur l'argent réellement investi
    const cashOnCash = cashTotal > 0 ? ((cashflowMois * 12) / cashTotal) * 100 : null;

    return {
      prix, revenusAn, nbUnites, mdf, mdfMin, prime, taxePrime, pret, hypo,
      taxesAn, depensesAn, cashflowMois, coutHabitation, loyersPercusMois,
      loyerOccupe, loyerOccupeEstime, repartition, mrb, capRate, bienvenue, fraisNotaire, cashClotures, travaux,
      cashTotal, tauxEffectif, dscr, prixParPorte, cashOnCash, noiAn
    };
  }

  // ---------- Extraction des données de la fiche Centris ----------
  // Trois couches, de la plus fiable à la moins fiable :
  // 1) Données structurées JSON-LD (schema.org) présentes dans le code
  // 2) Balises meta / microdata (itemprop, og:)
  // 3) Balayage du texte visible de la page
  function extraireJSONLD() {
    const out = { prix: null, adresse: "" };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        let data = JSON.parse(s.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const it of items) {
          const offre = it.offers || it;
          if (!out.prix && offre && offre.price) out.prix = parseMoney(String(offre.price));
          const a = it.address;
          if (!out.adresse && a) {
            out.adresse = [a.streetAddress, a.addressLocality].filter(Boolean).join(", ");
          }
        }
      } catch { /* JSON-LD illisible : on passe à la couche suivante */ }
    });
    return out;
  }

  function extraireFiche() {
    const d = { prix: null, revenusAn: null, taxeMuni: null, taxeScol: null, nbUnites: null, type: "", adresse: "" };

    // Couche 1 : JSON-LD
    try {
      const ld = extraireJSONLD();
      d.prix = ld.prix;
      d.adresse = ld.adresse;
    } catch { /* on continue */ }

    // Couche 2 : microdata / meta
    if (!d.prix) {
      const priceEl = document.querySelector(
        '[itemprop="price"], meta[itemprop="price"], meta[property="product:price:amount"], #BuyPrice, .price'
      );
      if (priceEl) d.prix = parseMoney(priceEl.getAttribute("content") || priceEl.textContent);
    }
    if (!d.adresse) {
      const addr = document.querySelector('[itemprop="address"], .address, h2[itemprop="address"]');
      if (addr) d.adresse = addr.textContent.trim().replace(/\s+/g, " ");
    }
    const titre = document.querySelector('h1, [data-id="PageTitle"], .house-info h1');
    if (titre) d.type = titre.textContent.trim().replace(/\s+/g, " ");

    // Nombre d'unités selon le titre (Duplex / Triplex / Quadruplex)
    const t = (d.type + " " + document.title).toLowerCase();
    if (t.includes("quadruplex")) d.nbUnites = 4;
    else if (t.includes("triplex")) d.nbUnites = 3;
    else if (t.includes("duplex")) d.nbUnites = 2;

    // Couche 3 : balayage du texte — on cherche le plus petit élément
    // contenant le libellé, pour éviter d'attraper un montant voisin
    const scan = (labelRegex) => {
      let meilleur = null, meilleureTaille = Infinity;
      const nodes = document.querySelectorAll(
        ".carac-container, .financial-details-table tr, table tr, .row, li, dl, div, span"
      );
      for (const el of nodes) {
        const txt = (el.textContent || "").replace(/\s+/g, " ");
        if (txt.length > 200 || !labelRegex.test(txt)) continue;
        const val = parseMoney(txt.replace(labelRegex, ""));
        if (val && val > 100 && txt.length < meilleureTaille) {
          meilleur = val;
          meilleureTaille = txt.length;
        }
      }
      return meilleur;
    };

    try {
      d.revenusAn = scan(/revenus?\s+bruts?(\s+potentiels?)?/i);
      d.taxeMuni = scan(/municipales?\s*(\(\s*20\d\d\s*\))?/i);
      d.taxeScol = scan(/scolaires?\s*(\(\s*20\d\d\s*\))?/i);
    } catch { /* le panneau restera en mode manuel */ }

    // --- Détails « fiche d'agent » ---
    // Valeur texte : plus petit élément contenant le libellé, on extrait le motif
    const scanTexte = (labelRegex, valueRegex) => {
      let meilleur = null, taille = Infinity;
      for (const el of document.querySelectorAll(".carac-container, table tr, .row, li, div")) {
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length > 160 || !labelRegex.test(txt)) continue;
        const m = txt.replace(labelRegex, "").match(valueRegex);
        if (m && txt.length < taille) { meilleur = m[1].trim(); taille = txt.length; }
      }
      return meilleur;
    };

    try {
      d.annee = scanTexte(/année de construction/i, /\b((?:18|19|20)\d\d)\b/);
      d.style = scanTexte(/style de bâtiment/i, /^\s*([A-Za-zÀ-ÿ' -]{3,25})/);
      d.terrain = scanTexte(/superficie du terrain/i, /([\d\s]{2,9}\s*(?:pc|pi2|m2|m²))/i);
      d.unitesDetail = scanTexte(/unités résidentielles/i, /([\dx½⅓,\s]{3,40})/);
      // Évaluation municipale : la ligne « Total » avec un montant substantiel
      // (dans un tableau, « Total » peut coller au montant : « Total780 100 $ »)
      let evalTotal = null;
      for (const el of document.querySelectorAll("table tr, .row, li, div")) {
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (txt.length > 60 || !/^total(?![a-zà-ÿ])/i.test(txt)) continue;
        const v = parseMoney(txt.replace(/^total/i, ""));
        if (v && v > 100000 && (!evalTotal || v > evalTotal)) evalTotal = v;
      }
      d.evalMunicipale = evalTotal;
    } catch { /* détails optionnels */ }

    return d;
  }

  const estFichePlex = () => {
    const t = (document.title + " " + location.pathname).toLowerCase();
    return /duplex|triplex|quadruplex|plex/.test(t) && /~|\/fr\/|\/en\//.test(location.pathname);
  };

  // ---------- Panneau injecté ----------
  let panel, inputs = {}, donnees = {};

  // Trouve le bloc de la fiche sous lequel insérer la section (comme
  // Keepa sous le prix Amazon). Repli : panneau flottant.
  function trouverAncrage() {
    const cands = [
      document.querySelector(".price-container"),
      document.querySelector('[itemprop="price"]'),
      document.querySelector(".house-info"),
      document.querySelector('[data-id="PageTitle"]'),
      document.querySelector("h1")
    ].filter(Boolean);
    for (const el of cands) {
      let b = el;
      let hops = 0;
      while (b.parentElement && b.parentElement !== document.body &&
             b.getBoundingClientRect().width < 560 && hops < 6) {
        b = b.parentElement;
        hops++;
      }
      if (b && b !== document.body && b.getBoundingClientRect().width >= 400) return b;
    }
    return null;
  }

  // ---------- Historique de prix (comme Keepa) ----------
  function cleFiche() {
    return "pcH:" + location.pathname.split("?")[0];
  }

  function enregistrerPrix(prix, cb) {
    if (!prix) return cb([]);
    const cle = cleFiche();
    chrome.storage.local.get({ [cle]: [] }, (res) => {
      const hist = res[cle];
      const dernier = hist[hist.length - 1];
      if (!dernier || dernier.prix !== prix) {
        hist.push({ date: new Date().toISOString().slice(0, 10), prix });
        chrome.storage.local.set({ [cle]: hist });
      }
      cb(hist);
    });
  }

  function htmlHistorique(hist) {
    if (!hist || hist.length < 2) return "";
    const premier = hist[0], dernier = hist[hist.length - 1];
    const delta = dernier.prix - premier.prix;
    const cls = delta < 0 ? "pc-good" : delta > 0 ? "pc-bad" : "";
    const chaine = hist
      .map((h) => `${fmt(h.prix)} <em>(${h.date})</em>`)
      .join(" → ");
    return `<div class="pc-histo ${cls}">Historique du prix observé : ${chaine}
      ${delta ? ` — <b>${delta < 0 ? "▼" : "▲"} ${fmt(Math.abs(delta))}</b>` : ""}</div>`;
  }

  function ligneKV(label, id, valeur, editable = true, suffix = "$") {
    return `
      <div class="pc-kv">
        <label for="pc-${id}">${label}</label>
        ${editable
          ? `<span class="pc-input-wrap"><input id="pc-${id}" type="text" inputmode="numeric" value="${valeur ?? ""}"><em>${suffix}</em></span>`
          : `<span class="pc-val" id="pc-${id}">${valeur}</span>`}
      </div>`;
  }

  function construirePanneau(d) {
    panel = document.createElement("section");
    panel.id = "plexcompare-panel";
    panel.innerHTML = `
      <header class="pc-head">
        <span class="pc-logo">PlexCompare</span>
        <span class="pc-type">${d.nbUnites ? d.nbUnites + " logements" : "Plex"}</span>
        <span class="pc-status" id="pc-status"></span>
        <button class="pc-add" id="pc-add">＋ Ajouter à notre liste</button>
        <button class="pc-toggle" title="Réduire">–</button>
      </header>

      <div class="pc-identite">
        <div class="pc-id-gauche">
          <span class="pc-id-adresse">${d.adresse || d.type || "Propriété"}</span>
          <div class="pc-id-chips">
            ${d.unitesDetail ? `<span class="pc-id-chip">${d.unitesDetail}</span>` : ""}
            ${d.annee ? `<span class="pc-id-chip">Construit ${d.annee}</span>` : ""}
            ${d.style ? `<span class="pc-id-chip">${d.style}</span>` : ""}
            ${d.terrain ? `<span class="pc-id-chip">Terrain ${d.terrain}</span>` : ""}
          </div>
        </div>
        <div class="pc-id-droite" id="pc-vs-eval"></div>
      </div>

      <div class="pc-body">
        <section class="pc-hero">
          <span class="pc-hero-label">Votre coût réel d'habitation</span>
          <span class="pc-hero-num" id="pc-cout">—</span>
          <span class="pc-hero-sub">par mois, loyers des autres unités déduits</span>
        </section>

        <section class="pc-grid" id="pc-resultats"></section>
      </div>

      <div class="pc-scen">
        <span class="pc-scen-label">Et si?</span>
        <button class="pc-chip" data-scen="stress">Taux +1,5 %</button>
        <button class="pc-chip" data-scen="mdf20">Mise de fonds 20 %</button>
        <button class="pc-chip" data-scen="marche" title="Utilise le champ « Revenus au marché »">Loyers au marché</button>
      </div>

      <div class="pc-repartition" id="pc-repartition" style="display:none"></div>

      <div id="pc-historique"></div>

      <details class="pc-details">
        <summary>Ajuster les chiffres de cette fiche <em>(loyers réels, travaux…)</em></summary>
        <div class="pc-form">
          ${ligneKV("Prix demandé", "prix", d.prix)}
          ${ligneKV("Revenus bruts / an", "revenus", d.revenusAn)}
          ${ligneKV("Revenus au marché / an", "marche", "")}
          ${ligneKV("Taxes municipales / an", "muni", d.taxeMuni)}
          ${ligneKV("Taxes scolaires / an", "scol", d.taxeScol)}
          ${ligneKV("Loyer de votre unité / mois (vide = moyenne)", "occupe", settings.loyerUniteOccupee || "")}
          ${ligneKV("Travaux estimés", "travaux", "")}
          ${ligneKV("Mise de fonds (vide = minimum)", "mdf", "")}
        </div>
      </details>`;

    const ancrage = trouverAncrage();
    if (ancrage) {
      ancrage.insertAdjacentElement("afterend", panel);
    } else {
      panel.classList.add("pc-floating");
      document.body.appendChild(panel);
    }

    // Historique de prix façon Keepa
    enregistrerPrix(d.prix, (hist) => {
      panel.querySelector("#pc-historique").innerHTML = htmlHistorique(hist);
    });

    ["prix", "revenus", "marche", "muni", "scol", "occupe", "travaux", "mdf"].forEach((id) => {
      inputs[id] = panel.querySelector("#pc-" + id);
      inputs[id].addEventListener("input", rafraichir);
    });

    // Scénarios « Et si? »
    panel.querySelectorAll(".pc-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const k = chip.dataset.scen;
        scen[k] = !scen[k];
        chip.classList.toggle("pc-chip-on", scen[k]);
        if (k === "marche" && scen.marche && !parseMoney(inputs.marche.value)) {
          panel.querySelector(".pc-details").open = true;
          inputs.marche.focus();
        }
        rafraichir();
      });
    });

    // Ouvre le formulaire et surligne les champs que l'extraction n'a pas trouvés
    marquerChampsManquants();

    panel.querySelector(".pc-toggle").addEventListener("click", () => {
      panel.classList.toggle("pc-collapsed");
      panel.querySelector(".pc-toggle").textContent = panel.classList.contains("pc-collapsed") ? "+" : "–";
    });

    panel.querySelector("#pc-add").addEventListener("click", envoyerVersListe);
    rafraichir();
  }

  // Champs essentiels vides → bordure orange + formulaire ouvert
  function marquerChampsManquants() {
    let manquant = false;
    ["prix", "revenus", "muni", "scol"].forEach((id) => {
      const vide = !parseMoney(inputs[id].value);
      inputs[id].parentElement.classList.toggle("pc-manquant", vide);
      if (vide) manquant = true;
    });
    if (manquant) {
      panel.querySelector(".pc-details").open = true;
      const st = panel.querySelector("#pc-status");
      if (!st.textContent) {
        st.textContent = "Certains chiffres n'ont pas été trouvés — complète les champs orangés.";
        st.className = "pc-status pc-bad";
      }
    }
  }

  // Centris charge parfois les caractéristiques après coup : on retente
  // de remplir les champs encore vides sans écraser ce que tu as tapé
  function completerChampsVides() {
    if (!panel || !inputs.prix) return;
    const d = extraireFiche();
    const map = { prix: d.prix, revenus: d.revenusAn, muni: d.taxeMuni, scol: d.taxeScol };
    let change = false;
    for (const id in map) {
      if (!parseMoney(inputs[id].value) && map[id]) {
        inputs[id].value = map[id];
        change = true;
      }
    }
    if (change) {
      donnees = { ...donnees, ...d };
      const st = panel.querySelector("#pc-status");
      st.textContent = "";
      st.className = "pc-status";
      marquerChampsManquants();
      rafraichir();
    }
  }

  function lireIntrants() {
    return {
      prix: parseMoney(inputs.prix.value),
      revenusAn: parseMoney(inputs.revenus.value),
      revenusMarche: parseMoney(inputs.marche.value),
      taxeMuni: parseMoney(inputs.muni.value),
      taxeScol: parseMoney(inputs.scol.value),
      loyerOccupe: parseMoney(inputs.occupe.value),
      travaux: parseMoney(inputs.travaux.value),
      miseDeFonds: parseMoney(inputs.mdf.value),
      nbUnites: donnees.nbUnites || 2,
      unitesDetail: donnees.unitesDetail || null
    };
  }

  function classeCashflow(v) {
    if (v === null || !isFinite(v)) return "";
    if (v >= 0) return "pc-good";
    if (v > -500) return "pc-mid";
    return "pc-bad";
  }

  function rafraichir() {
    const r = calculer(lireIntrants());

    // Prix vs évaluation municipale — le premier réflexe d'un agent
    const vs = panel.querySelector("#pc-vs-eval");
    if (vs) {
      if (donnees.evalMunicipale && r.prix) {
        const ecart = ((r.prix - donnees.evalMunicipale) / donnees.evalMunicipale) * 100;
        const cls = ecart <= 10 ? "pc-good" : ecart <= 30 ? "pc-mid" : "pc-bad";
        vs.innerHTML = `
          <span class="pc-id-prix">${fmt(r.prix)}</span>
          <span class="pc-id-eval">Évaluation ${fmt(donnees.evalMunicipale)}
            <b class="${cls}">${ecart >= 0 ? "+" : ""}${fmtPct(ecart, 0)} %</b></span>`;
      } else {
        vs.innerHTML = `<span class="pc-id-prix">${fmt(r.prix)}</span>`;
      }
    }

    const cout = panel.querySelector("#pc-cout");
    cout.textContent = fmt(r.coutHabitation) + " /mois";
    cout.className = "pc-hero-num " + (r.coutHabitation <= 1200 ? "pc-good" : r.coutHabitation <= 2200 ? "pc-mid" : "pc-bad");

    const sub = panel.querySelector(".pc-hero-sub");
    if (sub) {
      sub.textContent = r.loyerOccupe
        ? `en habitant une unité (la vôtre ${r.loyerOccupeEstime ? "estimée à" : "à"} ${fmt(r.loyerOccupe)}/mois), loyers des ${Math.max(r.nbUnites - 1, 1)} autres déduits`
        : "par mois, loyers des autres unités déduits";
    }

    // Répartition des loyers estimés par unité (vous = la plus grande)
    const rep = panel.querySelector("#pc-repartition");
    if (rep) {
      const tailles = r.repartition.map((u) => u.taille);
      const toutesEgales = tailles.every((t) => t === tailles[0]) || tailles.every((t) => t === 1);
      if (r.revenusAn && r.repartition.length > 1 && !toutesEgales) {
        rep.innerHTML = "Loyers estimés par taille : " + r.repartition
          .map((u) => {
            const nom = u.taille > 1 ? String(u.taille).replace(".5", "½").replace(/^(\d+)½$/, "$1½") : "unité";
            const lib = u.taille > 1 ? (Number.isInteger(u.taille) ? u.taille + "" : Math.floor(u.taille) + "½") : "unité";
            return `<span class="${u.occupe ? "pc-rep-vous" : ""}">${lib} ≈ ${fmt(u.loyer)}${u.occupe ? " (vous)" : ""}</span>`;
          })
          .join(" · ");
        rep.style.display = "";
      } else {
        rep.style.display = "none";
      }
    }

    panel.querySelector("#pc-resultats").innerHTML = `
      <div class="pc-cell ${classeCashflow(r.cashflowMois)}">
        <b>${fmt(r.cashflowMois)}</b><span>Cashflow /mois<br>si un jour tout est loué</span>
      </div>
      <div class="pc-cell"><b>${fmtPct(r.mrb, 1)}×</b><span>MRB<br>prix ÷ revenus bruts</span></div>
      <div class="pc-cell"><b>${fmtPct(r.capRate)} %</b><span>Taux de cap<br>(NOI ÷ prix)</span></div>
      <div class="pc-cell"><b>${fmt(r.hypo)}</b><span>Hypothèque /mois<br>${fmtPct(r.tauxEffectif)} % · ${settings.amortissement} ans${scen.stress ? " · stressé" : ""}</span></div>
      <div class="pc-cell"><b>${fmt(r.mdf)}</b><span>Mise de fonds<br>${r.prime ? "+ prime SCHL " + fmt(r.prime) : "sans prime SCHL"}</span></div>
      <div class="pc-cell"><b>${fmt(r.cashTotal)}</b><span>Cash total requis<br>MDF + bienvenue ${fmt(r.bienvenue)} + notaire${r.travaux ? " + travaux" : ""}</span></div>
      <div class="pc-cell ${r.dscr === null ? "" : r.dscr >= 1.2 ? "pc-good" : r.dscr >= 1.0 ? "pc-mid" : "pc-bad"}">
        <b>${fmtPct(r.dscr)}</b><span>DSCR<br>couverture de la dette (banques : ≥ 1,10)</span>
      </div>
      <div class="pc-cell"><b>${fmtPct(r.cashOnCash, 1)} %</b><span>Cash-on-cash<br>cashflow annuel ÷ cash investi</span></div>
      <div class="pc-cell"><b>${fmt(r.prixParPorte)}</b><span>Prix par porte<br>${r.nbUnites} logements</span></div>
      <div class="pc-cell"><b>${fmt(r.taxesAn)}</b><span>Taxes totales /an<br>muni + scolaires</span></div>
      <div class="pc-cell"><b>${fmt(r.revenusAn && r.nbUnites ? r.revenusAn / 12 / r.nbUnites : null)}</b><span>Loyer moyen /porte<br>revenus ÷ ${r.nbUnites} unités</span></div>`;
  }

  // ---------- Envoi vers la liste partagée (Google Sheets) ----------
  async function envoyerVersListe() {
    const status = panel.querySelector("#pc-status");
    if (!settings.sheetUrl) {
      status.textContent = "Configure l'URL du Sheet dans l'icône de l'extension.";
      status.className = "pc-status pc-bad";
      return;
    }
    const r = calculer(lireIntrants());
    const payload = {
      date: new Date().toLocaleDateString("fr-CA"),
      adresse: donnees.adresse || donnees.type || document.title,
      url: location.href.split("?")[0],
      prix: r.prix, unites: r.nbUnites, revenusAn: r.revenusAn,
      coutHabitation: Math.round(r.coutHabitation),
      cashflow: Math.round(r.cashflowMois),
      mrb: r.mrb ? +r.mrb.toFixed(1) : "",
      capRate: r.capRate ? +r.capRate.toFixed(2) : "",
      hypo: Math.round(r.hypo), miseDeFonds: Math.round(r.mdf),
      bienvenue: Math.round(r.bienvenue), travaux: r.travaux || 0,
      cashTotal: Math.round(r.cashTotal)
    };
    status.textContent = "Envoi…";
    status.className = "pc-status";
    try {
      await fetch(settings.sheetUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });
      status.textContent = "Ajoutée à votre liste ✓";
      status.className = "pc-status pc-good";
    } catch {
      status.textContent = "Échec de l'envoi — vérifie l'URL du script.";
      status.className = "pc-status pc-bad";
    }
  }

  // ---------- Badges MRB sur les résultats de recherche ----------
  function poserBadges() {
    const cartes = document.querySelectorAll(".property-thumbnail-item, .shell, .thumbnailItem");
    cartes.forEach((carte) => {
      if (carte.dataset.pcBadge) return;
      const txt = carte.textContent || "";
      if (!/duplex|triplex|quadruplex/i.test(txt)) return;
      const prixEl = carte.querySelector(".price, [itemprop='price']");
      const prix = prixEl ? parseMoney(prixEl.getAttribute("content") || prixEl.textContent) : null;
      const mRev = txt.match(/revenus?\s+bruts?[^\d]*([\d\s]+)\s*\$/i);
      const rev = mRev ? parseMoney(mRev[1]) : null;
      if (!prix || !rev) return;
      const mrb = prix / rev;
      const badge = document.createElement("span");
      badge.className = "pc-badge " + (mrb <= 15 ? "pc-good" : mrb <= 19 ? "pc-mid" : "pc-bad");
      badge.textContent = "MRB " + mrb.toFixed(1) + "×";
      (prixEl?.parentElement || carte).appendChild(badge);
      carte.dataset.pcBadge = "1";
    });
  }

  // ---------- Démarrage ----------
  let dernierChemin = location.pathname;

  function demarrer() {
    try {
      // Centris navigue parfois sans recharger la page : on suit l'URL
      if (location.pathname !== dernierChemin) {
        dernierChemin = location.pathname;
        const ancien = document.getElementById("plexcompare-panel");
        if (ancien) ancien.remove();
        panel = null;
        inputs = {};
        scen = { stress: false, mdf20: false, marche: false };
      }

      if (estFichePlex()) {
        if (!document.getElementById("plexcompare-panel")) {
          donnees = extraireFiche();
          construirePanneau(donnees);
        } else {
          completerChampsVides();
        }
      }
      poserBadges();
    } catch (err) {
      // Jamais de panne silencieuse qui casse la page Centris
      console.warn("PlexCompare :", err);
    }
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    demarrer();
    // Contenu dynamique : on surveille les changements du DOM et de l'URL
    const obs = new MutationObserver(() => {
      clearTimeout(obs._t);
      obs._t = setTimeout(demarrer, 600);
    });
    obs.observe(document.body, { childList: true, subtree: true });
    setInterval(demarrer, 3000); // filet de sécurité si l'observateur rate un changement
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const k in changes) settings[k] = changes[k].newValue;
    if (panel) rafraichir();
  });

  // Crochets de test (inactifs en usage normal)
  if (typeof window !== "undefined" && window.__PC_TEST__) {
    window.__pc = {
      paiementMensuel, taxeBienvenue, miseDeFondsMin, primeSCHL,
      calculer, parseMoney, extraireFiche,
      get settings() { return settings; },
      get scen() { return scen; }
    };
  }
})();
