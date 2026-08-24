/* ============================================================
   PlexCompare — content script
   S'injecte sur centris.ca :
   - Fiche détaillée : extrait prix, revenus, taxes, unités → panneau
     de rentabilité avec champs modifiables et mémorisés.
   - Résultats de recherche : badge MRB sur les vignettes.

   Les calculs vivent dans finance.js ; ce fichier ne fait que lire la
   page, dessiner le panneau et persister vos ajustements.
   ============================================================ */

(() => {
  "use strict";

  const DEFAULTS = window.PC_DEFAULTS;
  const { parseMoney, fmt, fmtPct, calculer, ANNEE_MUTATION } = window.PC;

  let settings = { ...DEFAULTS };
  let scen = { stress: false, mdf20: false, marche: false, invest: false };

  // Champs modifiables du panneau, dans l'ordre du formulaire
  const CHAMPS_FICHE = [
    "prix", "revenus", "marche", "autres", "muni", "scol",
    "occupe", "travaux", "mdf"
  ];

  // ---------- Sécurité ----------
  // Tout ce qui vient de la page Centris ou du Sheet traverse esc()
  // avant d'entrer dans un innerHTML.
  const ECHAPPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ECHAPPE[c]);

  // ============================================================
  //  Extraction des données de la fiche
  // ============================================================

  // Un seul balayage du DOM pour tous les libellés recherchés, et
  // uniquement pour ceux qui manquent encore. L'ancienne version
  // relançait six balayages complets à chaque frappe au clavier.
  const SELECTEUR_SCAN =
    ".carac-container, .financial-details-table tr, table tr, .row, li, dl, dt, dd, div, span";

  const BESOINS = [
    { cle: "revenusAn", type: "argent", maxLen: 200, min: 100,
      re: /revenus?\s+bruts?(\s+potentiels?)?/i },
    { cle: "taxeMuni", type: "argent", maxLen: 200, min: 50,
      re: /municipales?\s*(\(\s*20\d\d\s*\))?/i },
    { cle: "taxeScol", type: "argent", maxLen: 200, min: 20,
      re: /scolaires?\s*(\(\s*20\d\d\s*\))?/i },
    { cle: "evalMunicipale", type: "argent", maxLen: 60, min: 100000, preferer: "max",
      re: /^total(?![a-zà-ÿ])/i },
    { cle: "annee", type: "texte", maxLen: 160,
      re: /année de construction/i, valeurRe: /\b((?:18|19|20)\d\d)\b/ },
    { cle: "style", type: "texte", maxLen: 160,
      re: /style de bâtiment/i, valeurRe: /^\s*([A-Za-zÀ-ÿ' -]{3,25})/ },
    { cle: "terrain", type: "texte", maxLen: 160,
      re: /superficie du terrain/i, valeurRe: /([\d\s]{2,9}\s*(?:pc|pi2|m2|m²))/i },
    { cle: "unitesDetail", type: "texte", maxLen: 160,
      re: /unités résidentielles/i, valeurRe: /([\dx½⅓,\s]{3,40})/ },
    { cle: "nbUnitesTexte", type: "texte", maxLen: 120,
      re: /nombre d'unités|nombre de logements/i, valeurRe: /(\d{1,2})/ }
  ];

  function balayer(clesManquantes) {
    const besoins = BESOINS.filter((b) => clesManquantes.includes(b.cle));
    if (!besoins.length) return {};

    const trouve = {};
    const score = {}; // taille du plus petit élément retenu par clé

    for (const el of document.querySelectorAll(SELECTEUR_SCAN)) {
      // Un conteneur agrège trop de texte pour être fiable, et se relire
      // soi-même ferait boucler l'extraction sur nos propres chiffres.
      if (el.children.length > 12) continue;
      if (el.closest("#plexcompare-panel")) continue;

      const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!txt) continue;

      for (const b of besoins) {
        if (txt.length > b.maxLen || !b.re.test(txt)) continue;
        const reste = txt.replace(b.re, "");

        if (b.type === "argent") {
          const v = parseMoney(reste);
          if (v == null || v <= b.min) continue;
          if (b.preferer === "max") {
            // Évaluation municipale : on veut le plus gros « Total » de la page
            if (trouve[b.cle] == null || v > trouve[b.cle]) trouve[b.cle] = v;
          } else if (txt.length < (score[b.cle] ?? Infinity)) {
            // Sinon : l'élément le plus court contenant le libellé, pour
            // éviter d'attraper le montant de la ligne voisine
            trouve[b.cle] = v;
            score[b.cle] = txt.length;
          }
        } else {
          if (txt.length >= (score[b.cle] ?? Infinity)) continue;
          const m = reste.match(b.valeurRe);
          if (m) { trouve[b.cle] = m[1].trim(); score[b.cle] = txt.length; }
        }
      }
    }
    return trouve;
  }

  function extraireJSONLD() {
    const out = { prix: null, adresse: "" };
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const data = JSON.parse(s.textContent);
        for (const it of Array.isArray(data) ? data : [data]) {
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

  // Titre → nombre de logements
  const MOTS_UNITES = [
    [/unifamiliale/i, 1], [/duplex/i, 2], [/triplex/i, 3],
    [/quadruplex|quatriplex/i, 4], [/quintuplex/i, 5],
    [/sextuplex/i, 6], [/septuplex/i, 7], [/octuplex/i, 8]
  ];

  /**
   * @param precedent données déjà extraites — on ne recherche que ce qui manque.
   */
  function extraireFiche(precedent) {
    const d = { ...(precedent || {}) };

    // Couche 1 : données structurées JSON-LD
    if (!d.prix || !d.adresse) {
      try {
        const ld = extraireJSONLD();
        d.prix = d.prix || ld.prix;
        d.adresse = d.adresse || ld.adresse;
      } catch { /* on continue */ }
    }

    // Couche 2 : microdata / meta
    if (!d.prix) {
      const el = document.querySelector(
        '[itemprop="price"], meta[itemprop="price"], meta[property="product:price:amount"], #BuyPrice, .price'
      );
      if (el) d.prix = parseMoney(el.getAttribute("content") || el.textContent);
    }
    if (!d.adresse) {
      const el = document.querySelector('[itemprop="address"], .address, h2[itemprop="address"]');
      if (el) d.adresse = el.textContent.trim().replace(/\s+/g, " ");
    }
    if (!d.type) {
      const el = document.querySelector('h1, [data-id="PageTitle"], .house-info h1');
      if (el) d.type = el.textContent.trim().replace(/\s+/g, " ");
    }

    // Couche 3 : balayage du texte, une seule passe, seulement les manquants
    try {
      const manquantes = BESOINS.map((b) => b.cle).filter((c) => d[c] == null || d[c] === "");
      Object.assign(d, balayer(manquantes));
    } catch { /* le panneau restera en mode manuel */ }

    // Nombre de logements : titre d'abord, puis le texte de la fiche
    if (!d.nbUnites) {
      const t = (d.type || "") + " " + document.title;
      for (const [re, n] of MOTS_UNITES) if (re.test(t)) { d.nbUnites = n; break; }
    }
    if (!d.nbUnites && d.nbUnitesTexte) {
      const n = parseInt(d.nbUnitesTexte, 10);
      if (n >= 1 && n <= 12) d.nbUnites = n;
    }
    if (!d.nbUnites && d.unitesDetail) {
      const u = window.PC.parseUnites(d.unitesDetail);
      if (u) d.nbUnites = u.length;
    }

    return d;
  }

  // Les quatre chiffres sans lesquels le panneau ne dit rien d'utile
  const ESSENTIELS = ["prix", "revenusAn", "taxeMuni", "taxeScol"];
  const donneesCompletes = (d) => ESSENTIELS.every((c) => d && d[c] != null);

  // ---------- Reconnaissance d'une fiche ----------
  const RE_PLEX =
    /duplex|triplex|quadruplex|quatriplex|quintuplex|sextuplex|septuplex|octuplex|multiplex|plex|immeuble\s+à\s+revenus|maison\s+de\s+chambres/i;

  function estFichePlex() {
    const chemin = location.pathname.split("?")[0];
    const t = document.title + " " + chemin + " " +
      (document.querySelector("h1")?.textContent || "");
    if (!RE_PLEX.test(t)) return false;
    // Page de détail : l'URL se termine par le numéro d'inscription, ou la
    // page expose le bloc de prix d'une fiche. On ne se fie surtout pas à
    // [itemprop=price] : les vignettes d'une page de résultats en portent
    // aussi, ce qui ferait apparaître le panneau sur une liste.
    return /\/\d{6,}\/?$/.test(chemin) ||
      !!document.querySelector("#BuyPrice, .price-container");
  }

  // ============================================================
  //  Mémoire par fiche
  // ============================================================

  const cleFiche = () => location.pathname.split("?")[0].replace(/\/$/, "");
  const cleOverride = () => "pcO:" + cleFiche();
  const cleHistorique = () => "pcH:" + cleFiche();

  let champsTouches = new Set(); // uniquement ce que VOUS avez tapé
  let overrideMaj = null;

  function chargerOverride(cb) {
    const k = cleOverride();
    chrome.storage.local.get({ [k]: null }, (r) => cb(r[k] || null));
  }

  // Débouncé : on n'écrit pas dans le storage à chaque caractère
  let minuterieSauvegarde = null;
  function sauverOverride() {
    clearTimeout(minuterieSauvegarde);
    minuterieSauvegarde = setTimeout(() => {
      const vals = {};
      for (const id of champsTouches) {
        const el = inputs[id];
        if (el && el.value.trim() !== "") vals[id] = el.value.trim();
      }
      const scenActifs = Object.keys(scen).filter((k) => scen[k]);
      const k = cleOverride();

      if (!Object.keys(vals).length && !scenActifs.length && !uniteChoisie) {
        chrome.storage.local.remove(k);
        overrideMaj = null;
      } else {
        overrideMaj = new Date().toISOString().slice(0, 10);
        chrome.storage.local.set({
          [k]: { maj: overrideMaj, vals, scen: scenActifs, unite: uniteChoisie }
        });
      }
      majBandeauMemoire();
    }, 400);
  }

  function oublierOverride() {
    chrome.storage.local.remove(cleOverride());
    champsTouches.clear();
    overrideMaj = null;
    location.reload();
  }

  // Purge l'historique de prix : une clé par fiche visitée s'accumulait
  // sans limite. On garde les 300 fiches les plus récemment vues.
  function purgerHistorique() {
    chrome.storage.local.get(null, (tout) => {
      const cles = Object.keys(tout || {}).filter((k) => k.startsWith("pcH:"));
      if (cles.length <= 400) return;
      const parRecence = cles
        .map((k) => {
          const h = tout[k];
          const derniere = Array.isArray(h) && h.length ? h[h.length - 1].date : "0000-00-00";
          return [k, derniere];
        })
        .sort((a, b) => (a[1] < b[1] ? 1 : -1));
      chrome.storage.local.remove(parRecence.slice(300).map((x) => x[0]));
    });
  }

  function enregistrerPrix(prix, cb) {
    if (!prix) return cb([]);
    const cle = cleHistorique();
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
    const delta = hist[hist.length - 1].prix - hist[0].prix;
    const cls = delta < 0 ? "pc-good" : delta > 0 ? "pc-bad" : "";
    const chaine = hist.map((h) => `${fmt(h.prix)} <em>(${esc(h.date)})</em>`).join(" → ");
    return `<div class="pc-histo ${cls}">Historique du prix observé : ${chaine}
      ${delta ? ` — <b>${delta < 0 ? "▼" : "▲"} ${fmt(Math.abs(delta))}</b>` : ""}</div>`;
  }

  // ============================================================
  //  Panneau
  // ============================================================

  let panel = null, inputs = {}, donnees = {};
  let uniteChoisie = 0; // index dans la liste triee du plus grand au plus petit
  let ecritureInterne = false;

  // Encadre nos propres écritures DOM pour que l'observateur les ignore
  function ecrire(fn) {
    ecritureInterne = true;
    try { fn(); } finally { setTimeout(() => { ecritureInterne = false; }, 0); }
  }

  // Trouve le bloc de la fiche sous lequel insérer la section (façon
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
      let b = el, hops = 0;
      while (b.parentElement && b.parentElement !== document.body &&
             b.getBoundingClientRect().width < 560 && hops < 6) {
        b = b.parentElement;
        hops++;
      }
      if (b && b !== document.body && b.getBoundingClientRect().width >= 400) return b;
    }
    return null;
  }

  function ligneKV(label, id, valeur, suffix = "$") {
    return `
      <div class="pc-kv">
        <label for="pc-${id}">${esc(label)}</label>
        <span class="pc-input-wrap">
          <input id="pc-${id}" type="text" inputmode="numeric" value="${esc(valeur ?? "")}">
          <em>${esc(suffix)}</em>
        </span>
      </div>`;
  }

  function construirePanneau(d, memoire) {
    panel = document.createElement("section");
    panel.id = "plexcompare-panel";
    if (settings.panneauReplie) panel.classList.add("pc-collapsed");

    const v = (memoire && memoire.vals) || {};

    panel.innerHTML = `
      <header class="pc-head">
        <span class="pc-logo">PlexCompare</span>
        <span class="pc-type">${d.nbUnites ? d.nbUnites + " logements" : "Plex"}</span>
        <span class="pc-status" id="pc-status"></span>
        <button class="pc-add" id="pc-add">＋ Ajouter à notre liste</button>
        <button class="pc-toggle" title="Réduire">${settings.panneauReplie ? "+" : "–"}</button>
      </header>

      <div class="pc-identite">
        <div class="pc-id-gauche">
          <span class="pc-id-adresse">${esc(d.adresse || d.type || "Propriété")}</span>
          <div class="pc-id-chips">
            ${d.unitesDetail ? `<span class="pc-id-chip">${esc(d.unitesDetail)}</span>` : ""}
            ${d.annee ? `<span class="pc-id-chip">Construit ${esc(d.annee)}</span>` : ""}
            ${d.style ? `<span class="pc-id-chip">${esc(d.style)}</span>` : ""}
            ${d.terrain ? `<span class="pc-id-chip">Terrain ${esc(d.terrain)}</span>` : ""}
          </div>
        </div>
        <div class="pc-id-droite" id="pc-vs-eval"></div>
      </div>

      <div class="pc-memoire" id="pc-memoire" style="display:none"></div>

      <div class="pc-body">
        <section class="pc-hero">
          <span class="pc-hero-label" id="pc-hero-label">Votre coût réel d'habitation</span>
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
        <button class="pc-chip" data-scen="invest" title="Vous n'habitez pas l'immeuble : 20 % comptant, aucune assurance SCHL, vacance sur tous les logements">Je n'y habite pas</button>
      </div>

      <div class="pc-repartition" id="pc-repartition" style="display:none"></div>

      <div id="pc-historique"></div>

      <details class="pc-details">
        <summary>Ajuster les chiffres de cette fiche <em>(loyers réels, travaux…)</em></summary>
        <div class="pc-form">
          ${ligneKV("Prix demandé", "prix", v.prix ?? d.prix)}
          ${ligneKV("Revenus bruts / an", "revenus", v.revenus ?? d.revenusAn)}
          ${ligneKV("Revenus au marché / an", "marche", v.marche ?? "")}
          ${ligneKV("Autres revenus / an (stationnement, buanderie)", "autres", v.autres ?? "")}
          ${ligneKV("Taxes municipales / an", "muni", v.muni ?? d.taxeMuni)}
          ${ligneKV("Taxes scolaires / an", "scol", v.scol ?? d.taxeScol)}
          ${ligneKV("Loyer de votre unité / mois (vide = estimé)", "occupe", v.occupe ?? (settings.loyerUniteOccupee || ""))}
          ${ligneKV("Travaux estimés", "travaux", v.travaux ?? "")}
          ${ligneKV("Mise de fonds (vide = minimum)", "mdf", v.mdf ?? "")}
        </div>
      </details>`;

    const ancrage = trouverAncrage();
    ecrire(() => {
      if (ancrage) {
        ancrage.insertAdjacentElement("afterend", panel);
      } else {
        panel.classList.add("pc-floating");
        document.body.appendChild(panel);
      }
    });

    // Restaure les scénarios mémorisés pour cette fiche
    if (memoire && Array.isArray(memoire.scen)) {
      for (const k of memoire.scen) if (k in scen) scen[k] = true;
    }
    overrideMaj = memoire ? memoire.maj : null;
    uniteChoisie = (memoire && memoire.unite) || 0;
    champsTouches = new Set(Object.keys(v));

    enregistrerPrix(d.prix, (hist) => {
      ecrire(() => { panel.querySelector("#pc-historique").innerHTML = htmlHistorique(hist); });
    });

    for (const id of CHAMPS_FICHE) {
      inputs[id] = panel.querySelector("#pc-" + id);
      if (v[id] != null) inputs[id].parentElement.classList.add("pc-ajuste");
      inputs[id].addEventListener("input", () => {
        champsTouches.add(id);
        inputs[id].parentElement.classList.add("pc-ajuste");
        inputs[id].parentElement.classList.remove("pc-manquant");
        sauverOverride();
        rafraichir();
      });
    }

    panel.querySelectorAll(".pc-chip").forEach((chip) => {
      const k = chip.dataset.scen;
      chip.classList.toggle("pc-chip-on", !!scen[k]);
      chip.addEventListener("click", () => {
        scen[k] = !scen[k];
        chip.classList.toggle("pc-chip-on", scen[k]);
        if (k === "marche" && scen.marche && !parseMoney(inputs.marche.value)) {
          panel.querySelector(".pc-details").open = true;
          inputs.marche.focus();
        }
        sauverOverride();
        rafraichir();
      });
    });

    panel.querySelector(".pc-toggle").addEventListener("click", () => {
      const replie = panel.classList.toggle("pc-collapsed");
      panel.querySelector(".pc-toggle").textContent = replie ? "+" : "–";
      chrome.storage.sync.set({ panneauReplie: replie });
    });

    // Le plus grand logement est un défaut, pas une fatalité : habiter le
    // petit et louer le grand change complètement le coût d'habitation.
    panel.querySelector("#pc-repartition").addEventListener("click", (e) => {
      const b = e.target.closest(".pc-rep-u");
      if (!b) return;
      uniteChoisie = parseInt(b.dataset.u, 10) || 0;
      sauverOverride();
      rafraichir();
    });

    panel.querySelector("#pc-add").addEventListener("click", envoyerVersListe);

    marquerChampsManquants();
    majBandeauMemoire();
    rafraichir();
  }

  function majBandeauMemoire() {
    if (!panel) return;
    const bandeau = panel.querySelector("#pc-memoire");
    if (!bandeau) return;
    if (!overrideMaj) { bandeau.style.display = "none"; return; }
    ecrire(() => {
      bandeau.innerHTML =
        `✎ Vos ajustements pour cette fiche sont enregistrés <em>(${esc(overrideMaj)})</em>
         <button class="pc-oublier" id="pc-oublier">Réinitialiser</button>`;
      bandeau.style.display = "";
      bandeau.querySelector("#pc-oublier").addEventListener("click", oublierOverride);
    });
  }

  // Champs essentiels vides → bordure orange + formulaire ouvert
  function marquerChampsManquants() {
    let manquant = false;
    for (const id of ["prix", "revenus", "muni", "scol"]) {
      const vide = parseMoney(inputs[id].value) == null;
      inputs[id].parentElement.classList.toggle("pc-manquant", vide);
      if (vide) manquant = true;
    }
    const st = panel.querySelector("#pc-status");
    if (manquant) {
      panel.querySelector(".pc-details").open = true;
      if (!st.textContent) {
        st.textContent = "Certains chiffres n'ont pas été trouvés — complète les champs orangés.";
        st.className = "pc-status pc-bad";
      }
    } else if (st.className.includes("pc-bad")) {
      st.textContent = "";
      st.className = "pc-status";
    }
  }

  // Centris charge parfois les caractéristiques après coup : on remplit
  // les champs encore vides sans jamais écraser ce que vous avez tapé.
  function completerChampsVides() {
    if (!panel || !inputs.prix) return;
    if (donneesCompletes(donnees)) return;

    donnees = extraireFiche(donnees);
    const map = { prix: donnees.prix, revenus: donnees.revenusAn, muni: donnees.taxeMuni, scol: donnees.taxeScol };
    let change = false;
    for (const id in map) {
      if (champsTouches.has(id)) continue;
      if (parseMoney(inputs[id].value) == null && map[id] != null) {
        inputs[id].value = map[id];
        change = true;
      }
    }
    if (change) { marquerChampsManquants(); rafraichir(); }
  }

  function lireIntrants() {
    return {
      prix: parseMoney(inputs.prix.value),
      revenusAn: parseMoney(inputs.revenus.value),
      revenusMarche: parseMoney(inputs.marche.value),
      autresRevenusAn: parseMoney(inputs.autres.value),
      taxeMuni: parseMoney(inputs.muni.value),
      taxeScol: parseMoney(inputs.scol.value),
      loyerOccupe: parseMoney(inputs.occupe.value),
      travaux: parseMoney(inputs.travaux.value),
      miseDeFonds: parseMoney(inputs.mdf.value),
      nbUnites: donnees.nbUnites || 2,
      unitesDetail: donnees.unitesDetail || null,
      uniteOccupee: uniteChoisie
    };
  }

  const classeCashflow = (v) =>
    v == null || !isFinite(v) ? "" : v >= 0 ? "pc-good" : v > -500 ? "pc-mid" : "pc-bad";

  function rafraichir() {
    if (!panel) return;
    const r = calculer(lireIntrants(), settings, scen);

    ecrire(() => {
      // Prix vs évaluation municipale — le premier réflexe d'un agent
      const vs = panel.querySelector("#pc-vs-eval");
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

      // Héro : coût d'habitation en mode occupant, cashflow en mode investisseur
      const label = panel.querySelector("#pc-hero-label");
      const cout = panel.querySelector("#pc-cout");
      const sub = panel.querySelector(".pc-hero-sub");

      if (r.occupant) {
        label.textContent = "Votre coût réel d'habitation";
        cout.textContent = fmt(r.coutHabitation) + " /mois";
        cout.className = "pc-hero-num " +
          (r.coutHabitation <= 1200 ? "pc-good" : r.coutHabitation <= 2200 ? "pc-mid" : "pc-bad");
        sub.textContent = r.loyerOccupe
          ? `en habitant une unité (la vôtre ${r.loyerOccupeEstime ? "estimée à" : "à"} ${fmt(r.loyerOccupe)}/mois), loyers des ${Math.max(r.nbUnites - 1, 1)} autres déduits`
          : "par mois, loyers des autres unités déduits";
      } else {
        label.textContent = "Cashflow net";
        cout.textContent = fmt(r.cashflowMois) + " /mois";
        cout.className = "pc-hero-num " + classeCashflow(r.cashflowMois);
        sub.textContent = `tous les logements loués · ${fmt(r.mdf)} comptant (20 %), prêt conventionnel`;
      }

      // Répartition des loyers estimés par unité
      const rep = panel.querySelector("#pc-repartition");
      const tailles = r.repartition.map((u) => u.taille);
      const toutesEgales = tailles.every((t) => t === tailles[0]);
      if (r.revenusLoyers && r.repartition.length > 1 && !toutesEgales) {
        rep.innerHTML = `<span class="pc-rep-lab">Vous habitez</span>` + r.repartition
          .map((u, i) => `<button type="button" class="pc-rep-u${u.occupe ? " pc-rep-vous" : ""}" data-u="${i}"
            title="Cliquez si c'est ce logement que vous occuperiez">${esc(u.libelle)} ≈ ${fmt(u.loyer)}</button>`)
          .join("");
        rep.style.display = "";
      } else {
        rep.style.display = "none";
      }

      const detailPrime = r.prime
        ? `+ prime SCHL ${fmt(r.prime)} (${fmtPct(r.tauxPrime * 100, 2)} %)`
        : "prêt conventionnel, sans SCHL";

      panel.querySelector("#pc-resultats").innerHTML = `
        <div class="pc-cell ${classeCashflow(r.cashflowMois)}">
          <b>${fmt(r.cashflowMois)}</b><span>Cashflow /mois<br>tous les logements loués</span>
        </div>
        <div class="pc-cell"><b>${fmt(r.sortiesMois)}</b><span>Sans locataires<br>si aucun logement n'était loué</span></div>
        <div class="pc-cell"><b>${fmtPct(r.mrb, 1)}×</b><span>MRB<br>prix ÷ revenus bruts</span></div>
        <div class="pc-cell"><b>${fmtPct(r.capRate)} %</b><span>Taux de cap<br>(NOI ÷ prix)</span></div>
        <div class="pc-cell"><b>${fmt(r.hypo)}</b><span>Hypothèque /mois<br>${fmtPct(r.tauxEffectif)} % · ${r.amort} ans${scen.stress ? " · stressé" : ""}</span></div>
        <div class="pc-cell"><b>${fmt(r.mdf)}</b><span>Mise de fonds<br>${detailPrime}</span></div>
        <div class="pc-cell"><b>${fmt(r.cashTotal)}</b><span>Cash total requis<br>MDF + bienvenue ${fmt(r.bienvenue)} + notaire + inspection${r.travaux ? " + travaux" : ""}</span></div>
        <div class="pc-cell ${r.dscr == null ? "" : r.dscr >= 1.2 ? "pc-good" : r.dscr >= 1.0 ? "pc-mid" : "pc-bad"}">
          <b>${fmtPct(r.dscr)}</b><span>DSCR<br>couverture de la dette (banques : ≥ 1,10)</span>
        </div>
        <div class="pc-cell"><b>${fmtPct(r.cashOnCash, 1)} %</b><span>Cash-on-cash<br>cashflow annuel ÷ cash investi</span></div>
        <div class="pc-cell"><b>${fmt(r.prixParPorte)}</b><span>Prix par porte<br>${r.nbUnites} logements</span></div>
        <div class="pc-cell"><b>${fmt(r.bienvenue)}</b><span>Taxe de bienvenue<br>grille ${ANNEE_MUTATION}${settings.villeMontreal ? " · Montréal" : " · Québec"}</span></div>
        <div class="pc-cell"><b>${fmt(r.taxesAn)}</b><span>Taxes totales /an<br>muni + scolaires</span></div>
        <div class="pc-cell"><b>${fmt(r.loyerMoyenPorte)}</b><span>Loyer moyen /porte<br>revenus ÷ ${r.nbUnites} unités</span></div>`;
    });
  }

  // ============================================================
  //  Envoi vers la liste partagée
  // ============================================================

  function envoyerVersListe() {
    const status = panel.querySelector("#pc-status");
    const dire = (txt, cls) => { status.textContent = txt; status.className = "pc-status " + (cls || ""); };

    if (!settings.sheetUrl) {
      dire("Configure l'URL du Sheet dans l'icône de l'extension.", "pc-bad");
      return;
    }

    const r = calculer(lireIntrants(), settings, scen);
    const payload = {
      action: "upsert",
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

    dire("Envoi…");
    // Passe par le service worker : un fetch depuis le content script est
    // soumis au CORS de centris.ca et ne peut pas confirmer le succès.
    chrome.runtime.sendMessage(
      { type: "pc-envoyer", url: settings.sheetUrl, payload },
      (rep) => {
        if (chrome.runtime.lastError) {
          dire("Échec — extension non disponible, recharge la page.", "pc-bad");
        } else if (rep && rep.ok) {
          dire(rep.miseAJour ? "Fiche mise à jour ✓" : "Ajoutée à votre liste ✓", "pc-good");
        } else {
          dire("Échec de l'envoi — " + ((rep && rep.erreur) || "vérifie l'URL du script."), "pc-bad");
        }
      }
    );
  }

  // ============================================================
  //  Badges MRB sur les résultats de recherche
  // ============================================================

  function poserBadges() {
    const cartes = document.querySelectorAll(".property-thumbnail-item, .shell, .thumbnailItem");
    cartes.forEach((carte) => {
      if (carte.dataset.pcBadge) return;
      const txt = carte.textContent || "";
      if (!RE_PLEX.test(txt)) return;
      const prixEl = carte.querySelector(".price, [itemprop='price']");
      const prix = prixEl ? parseMoney(prixEl.getAttribute("content") || prixEl.textContent) : null;
      const mRev = txt.match(/revenus?\s+bruts?[^\d]*([\d\s]+)\s*\$/i);
      const rev = mRev ? parseMoney(mRev[1]) : null;
      if (!prix || !rev) return;
      const mrb = prix / rev;
      const badge = document.createElement("span");
      badge.className = "pc-badge " + (mrb <= 15 ? "pc-good" : mrb <= 19 ? "pc-mid" : "pc-bad");
      badge.textContent = "MRB " + mrb.toFixed(1) + "×";
      ecrire(() => { (prixEl?.parentElement || carte).appendChild(badge); });
      carte.dataset.pcBadge = "1";
    });
  }

  // ============================================================
  //  Démarrage
  // ============================================================

  let dernierChemin = location.pathname;
  let observateur = null;
  let minuterieDebounce = null;

  function reinitialiser() {
    const ancien = document.getElementById("plexcompare-panel");
    if (ancien) ancien.remove();
    panel = null;
    inputs = {};
    donnees = {};
    champsTouches = new Set();
    overrideMaj = null;
    scen = { stress: false, mdf20: false, marche: false, invest: false };
    uniteChoisie = 0;
  }

  function demarrer() {
    try {
      if (estFichePlex()) {
        if (!document.getElementById("plexcompare-panel")) {
          donnees = extraireFiche(null);
          const d = donnees;
          chargerOverride((memoire) => {
            // La page a pu changer pendant la lecture du storage
            if (document.getElementById("plexcompare-panel")) return;
            construirePanneau(d, memoire);
            if (donneesCompletes(donnees) && observateur) observateur.disconnect();
          });
        } else {
          completerChampsVides();
          if (donneesCompletes(donnees) && observateur) observateur.disconnect();
        }
      }
      poserBadges();
    } catch (err) {
      // Jamais de panne silencieuse qui casse la page Centris
      console.warn("PlexCompare :", err);
    }
  }

  function planifier() {
    clearTimeout(minuterieDebounce);
    minuterieDebounce = setTimeout(demarrer, 600);
  }

  // Centris navigue sans recharger la page : on surveille l'URL.
  // Une simple comparaison de chaînes, contrairement à l'ancien
  // setInterval qui relançait une extraction complète toutes les 3 s.
  function surveillerUrl() {
    if (location.pathname === dernierChemin) return;
    dernierChemin = location.pathname;
    reinitialiser();
    if (observateur) observateur.observe(document.body, { childList: true, subtree: true });
    planifier();
  }

  chrome.storage.sync.get(DEFAULTS, (s) => {
    settings = { ...DEFAULTS, ...s };
    purgerHistorique();
    demarrer();

    observateur = new MutationObserver((mutations) => {
      if (ecritureInterne) return;
      for (const m of mutations) {
        const cible = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        // Nos propres écritures ne doivent pas déclencher une ré-extraction :
        // c'était la boucle qui relançait un balayage complet à chaque frappe.
        if (cible && cible.closest && cible.closest("#plexcompare-panel")) continue;
        planifier();
        return;
      }
    });
    observateur.observe(document.body, { childList: true, subtree: true });

    setInterval(surveillerUrl, 700);
  });

  chrome.storage.onChanged.addListener((changes, zone) => {
    if (zone !== "sync") return;
    let pertinent = false;
    for (const k in changes) {
      if (k === "panneauReplie") continue;
      settings[k] = changes[k].newValue;
      pertinent = true;
    }
    if (pertinent && panel) rafraichir();
  });

  // Crochets de test (inactifs en usage normal)
  if (window.__PC_TEST__) {
    window.__pc = {
      extraireFiche, balayer, estFichePlex, lireIntrants,
      get settings() { return settings; },
      get scen() { return scen; }
    };
  }
})();
