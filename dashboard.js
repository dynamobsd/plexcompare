/* PlexCompare — tableau de bord
   Lit votre Google Sheet partagé via le service worker et affiche toutes
   vos propriétés côte à côte : triables, filtrables, annotables. */

(() => {
  "use strict";

  const { fmt, fmtPct } = window.PC;
  const $ = (s) => document.querySelector(s);

  // ---------- État ----------
  let entetes = [];
  let props = [];                 // lignes brutes du Sheet
  let choisies = new Set();       // URL des propriétés cochées pour comparaison
  let tri = { cle: "cout", sens: 1 };
  let filtre = "";
  let sheetUrl = "";

  // Colonnes du Sheet — mêmes positions que ENTETES dans apps-script.gs
  const COL = {
    date: 0, adresse: 1, url: 2, prix: 3, unites: 4, revenus: 5,
    cout: 6, cashflow: 7, mrb: 8, cap: 9, hypo: 10, mdf: 11,
    bienvenue: 12, travaux: 13, cashTotal: 14, notes: 15, note: 16
  };

  // Définition des colonnes affichées : pilote l'entête ET le tri
  const COLONNES = [
    { cle: "sel", libelle: "", fige: true },
    { cle: "adresse", libelle: "Propriété", type: "texte", sens: 1 },
    { cle: "prix", libelle: "Prix", type: "num", sens: 1 },
    { cle: "unites", libelle: "Unités", type: "num", sens: -1 },
    { cle: "revenus", libelle: "Revenus/an", type: "num", sens: -1 },
    { cle: "cout", libelle: "Coût habitation", type: "num", sens: 1 },
    { cle: "cashflow", libelle: "Cashflow", type: "num", sens: -1 },
    { cle: "mrb", libelle: "MRB", type: "num", sens: 1 },
    { cle: "cap", libelle: "Cap", type: "num", sens: -1 },
    { cle: "cashTotal", libelle: "Cash requis", type: "num", sens: 1 },
    { cle: "note", libelle: "Note", type: "num", sens: -1 },
    { cle: "notes", libelle: "Nos notes", fige: true },
    { cle: "actions", libelle: "", fige: true }
  ];

  // ---------- Utilitaires ----------
  const ECHAPPE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ECHAPPE[c]);

  const num = (v) => {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  };

  // Une URL venant du Sheet finit dans un href : on refuse tout ce qui
  // n'est pas http(s) — un « javascript: » collé à la main s'exécuterait.
  const lienSur = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "");

  const cleLigne = (p) => String(p[COL.url] || "").split("?")[0].replace(/\/+$/, "").toLowerCase();

  function toast(txt, erreur) {
    const el = $("#toast");
    el.textContent = txt;
    el.className = "toast visible" + (erreur ? " erreur" : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = "toast"; }, 3200);
  }

  function classe(v, bonSi, seuilBon, seuilMoyen) {
    if (v == null) return "";
    const ok = bonSi === "haut" ? v >= seuilBon : v <= seuilBon;
    const moyen = bonSi === "haut" ? v >= seuilMoyen : v <= seuilMoyen;
    return ok ? "good" : moyen ? "mid" : "bad";
  }

  // ---------- Communication avec le Sheet ----------

  function envoyer(payload) {
    return new Promise((resoudre) => {
      chrome.runtime.sendMessage({ type: "pc-envoyer", url: sheetUrl, payload }, (rep) => {
        if (chrome.runtime.lastError) resoudre({ ok: false, erreur: "extension indisponible" });
        else resoudre(rep || { ok: false, erreur: "aucune réponse" });
      });
    });
  }

  // ---------- Sommaire ----------

  function afficherStats() {
    const col = (c) => props.map((p) => num(p[c])).filter((v) => v != null);
    const couts = col(COL.cout), cash = col(COL.cashflow), mrbs = col(COL.mrb);
    $("#stats").innerHTML = `
      <div class="stat"><b>${props.length}</b><span>propriétés sur votre liste</span></div>
      <div class="stat"><b>${couts.length ? fmt(Math.min(...couts)) : "—"}</b><span>meilleur coût d'habitation /mois</span></div>
      <div class="stat"><b>${cash.length ? fmt(Math.max(...cash)) : "—"}</b><span>meilleur cashflow /mois</span></div>
      <div class="stat"><b>${mrbs.length ? fmtPct(Math.min(...mrbs), 1) + "×" : "—"}</b><span>meilleur MRB</span></div>`;
  }

  // ---------- Tri et filtre ----------

  function visibles() {
    const f = filtre.trim().toLowerCase();
    const liste = !f
      ? props.slice()
      : props.filter((p) =>
          String(p[COL.adresse] || "").toLowerCase().includes(f) ||
          String(p[COL.notes] || "").toLowerCase().includes(f));

    const meta = COLONNES.find((c) => c.cle === tri.cle) || { type: "num" };
    const idx = COL[tri.cle];
    liste.sort((a, b) => {
      const va = meta.type === "texte" ? String(a[idx] || "").toLowerCase() : num(a[idx]);
      const vb = meta.type === "texte" ? String(b[idx] || "").toLowerCase() : num(b[idx]);
      // Les valeurs absentes tombent toujours en fin de liste
      if (va == null || va === "") return 1;
      if (vb == null || vb === "") return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * tri.sens;
    });
    return liste;
  }

  // ---------- Tableau ----------

  function afficherTableau() {
    const liste = visibles();
    $("#compteur").textContent = liste.length === props.length
      ? `${props.length} propriété${props.length > 1 ? "s" : ""}`
      : `${liste.length} sur ${props.length}`;

    if (!props.length) {
      $("#contenu").innerHTML = `<div class="message">
        <b>Votre liste est vide pour l'instant.</b><br><br>
        Ouvrez une fiche de plex sur Centris et cliquez
        <b>＋ Ajouter à notre liste</b> — elle apparaîtra ici.
      </div>`;
      return;
    }
    if (!liste.length) {
      $("#contenu").innerHTML = `<div class="message"><b>Aucune propriété ne correspond au filtre.</b></div>`;
      return;
    }

    const thead = COLONNES.map((c) => {
      const actif = !c.fige && tri.cle === c.cle ? " actif" : "";
      const fleche = actif ? (tri.sens === 1 ? " ↑" : " ↓") : "";
      const cls = (c.cle === "sel" ? "sel " : "") + (c.fige ? "fige" : "");
      return `<th class="${cls}${actif}" data-cle="${c.cle}">${esc(c.libelle)}${fleche}</th>`;
    }).join("");

    const lignes = liste.map((p, i) => {
      const cle = cleLigne(p);
      const cout = num(p[COL.cout]), cf = num(p[COL.cashflow]);
      const mrb = num(p[COL.mrb]), cap = num(p[COL.cap]);
      const note = num(p[COL.note]);
      const lien = lienSur(p[COL.url]);
      const titre = esc(p[COL.adresse] || "Fiche Centris");

      return `
      <tr class="${i === 0 ? "meilleur " : ""}${choisies.has(cle) ? "choisie" : ""}" data-cle="${esc(cle)}">
        <td class="sel"><input type="checkbox" class="pick" ${choisies.has(cle) ? "checked" : ""}></td>
        <td class="adresse">
          ${lien ? `<a href="${esc(lien)}" target="_blank" rel="noopener noreferrer" title="Ouvrir la fiche Centris">${titre}</a>` : titre}
          ${i === 0 ? '<span class="badge-top">№ 1</span>' : ""}
        </td>
        <td>${fmt(num(p[COL.prix]))}</td>
        <td>${esc(p[COL.unites] || "—")}</td>
        <td>${fmt(num(p[COL.revenus]))}</td>
        <td class="${classe(cout, "bas", 1200, 2200)}">${fmt(cout)}</td>
        <td class="${classe(cf, "haut", 0, -500)}">${fmt(cf)}</td>
        <td class="${classe(mrb, "bas", 15, 19)}">${mrb != null ? fmtPct(mrb, 1) + "×" : "—"}</td>
        <td>${cap != null ? fmtPct(cap, 2) + " %" : "—"}</td>
        <td>${fmt(num(p[COL.cashTotal]))}</td>
        <td class="editable">
          <input class="champ note editer" data-champ="note" type="number" min="0" max="10" step="0.5"
                 value="${esc(note != null ? note : "")}" placeholder="—">
        </td>
        <td class="notes editable">
          <input class="champ editer" data-champ="notes" type="text"
                 value="${esc(p[COL.notes] || "")}" placeholder="Ajouter une note…">
        </td>
        <td><button class="retirer" title="Retirer de la liste">✕</button></td>
      </tr>`;
    }).join("");

    $("#contenu").innerHTML = `
      <div class="wrap"><table>
        <thead><tr>${thead}</tr></thead>
        <tbody>${lignes}</tbody>
      </table></div>`;
  }

  // ---------- Comparaison côte à côte ----------

  const LIGNES_COMPARE = [
    { lib: "Prix", col: COL.prix, f: fmt, mieux: "bas" },
    { lib: "Unités", col: COL.unites, f: (v) => (v == null ? "—" : String(v)) },
    { lib: "Revenus bruts / an", col: COL.revenus, f: fmt, mieux: "haut" },
    { lib: "Coût d'habitation / mois", col: COL.cout, f: fmt, mieux: "bas" },
    { lib: "Cashflow / mois", col: COL.cashflow, f: fmt, mieux: "haut" },
    { lib: "MRB", col: COL.mrb, f: (v) => (v == null ? "—" : fmtPct(v, 1) + "×"), mieux: "bas" },
    { lib: "Taux de cap", col: COL.cap, f: (v) => (v == null ? "—" : fmtPct(v, 2) + " %"), mieux: "haut" },
    { lib: "Hypothèque / mois", col: COL.hypo, f: fmt, mieux: "bas" },
    { lib: "Mise de fonds", col: COL.mdf, f: fmt, mieux: "bas" },
    { lib: "Taxe de bienvenue", col: COL.bienvenue, f: fmt, mieux: "bas" },
    { lib: "Travaux estimés", col: COL.travaux, f: fmt, mieux: "bas" },
    { lib: "Cash total requis", col: COL.cashTotal, f: fmt, mieux: "bas" },
    { lib: "Notre note", col: COL.note, f: (v) => (v == null ? "—" : v + "/10"), mieux: "haut" }
  ];

  function afficherComparaison() {
    const zone = $("#comparaison");
    const sel = props.filter((p) => choisies.has(cleLigne(p)));
    $("#comparer").disabled = sel.length < 2;

    if (!zone.dataset.ouvert || sel.length < 2) {
      if (sel.length < 2) zone.dataset.ouvert = "";
      zone.innerHTML = "";
      return;
    }

    const entete = sel.map((p) => {
      const lien = lienSur(p[COL.url]);
      const titre = esc(p[COL.adresse] || "Fiche Centris");
      return `<th>${lien ? `<a href="${esc(lien)}" target="_blank" rel="noopener noreferrer">${titre}</a>` : titre}</th>`;
    }).join("");

    const corps = LIGNES_COMPARE.map((L) => {
      const vals = sel.map((p) => num(p[L.col]));
      const dispo = vals.filter((v) => v != null);
      // Une seule propriété peut gagner une ligne, et seulement s'il y a
      // vraiment un écart : sinon l'étoile ne veut rien dire.
      let gagnant = -1;
      if (L.mieux && dispo.length > 1 && Math.min(...dispo) !== Math.max(...dispo)) {
        const cible = L.mieux === "haut" ? Math.max(...dispo) : Math.min(...dispo);
        if (dispo.filter((v) => v === cible).length === 1) gagnant = vals.indexOf(cible);
      }
      const cells = vals.map((v, i) =>
        `<td class="${i === gagnant ? "gagnant" : ""}">${esc(L.f(v))}</td>`).join("");
      return `<tr><th>${esc(L.lib)}</th>${cells}</tr>`;
    }).join("");

    zone.innerHTML = `
      <div class="compare">
        <h2>Comparaison — <span>${sel.length} propriétés</span>
          <button id="fermer-compare">Fermer</button></h2>
        <table><thead><tr><th></th>${entete}</tr></thead><tbody>${corps}</tbody></table>
      </div>`;
    zone.querySelector("#fermer-compare").addEventListener("click", () => {
      zone.dataset.ouvert = "";
      afficherComparaison();
    });
  }

  // ---------- Export CSV ----------

  function exporterCSV() {
    const liste = visibles();
    if (!liste.length) return toast("Rien à exporter.", true);

    // Point-virgule + BOM : Excel en français ouvre le fichier correctement.
    const cellule = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
    const lignes = [entetes.map(cellule).join(";")]
      .concat(liste.map((p) => entetes.map((_, i) => cellule(p[i])).join(";")));

    const blob = new Blob(["﻿" + lignes.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `plexcompare-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(`${liste.length} propriété${liste.length > 1 ? "s" : ""} exportée${liste.length > 1 ? "s" : ""}.`);
  }

  // ---------- Actions sur une ligne ----------

  async function enregistrerNotes(ligne) {
    const p = props.find((x) => cleLigne(x) === ligne.dataset.cle);
    if (!p) return;
    const notes = ligne.querySelector('[data-champ="notes"]').value;
    const note = ligne.querySelector('[data-champ="note"]').value;

    const rep = await envoyer({ action: "notes", url: p[COL.url], notes, note });
    if (rep.ok) {
      p[COL.notes] = notes;
      p[COL.note] = note === "" ? "" : Number(note);
      toast("Note enregistrée ✓");
      afficherComparaison();
    } else {
      toast("Échec : " + rep.erreur, true);
    }
  }

  async function retirer(ligne, bouton) {
    const cle = ligne.dataset.cle;
    const p = props.find((x) => cleLigne(x) === cle);
    if (!p) return;

    // Confirmation en place plutôt qu'une boîte de dialogue
    if (!bouton.classList.contains("confirme")) {
      bouton.classList.add("confirme");
      bouton.textContent = "Confirmer";
      clearTimeout(bouton._t);
      bouton._t = setTimeout(() => {
        bouton.classList.remove("confirme");
        bouton.textContent = "✕";
      }, 4000);
      return;
    }

    bouton.textContent = "…";
    const rep = await envoyer({ action: "delete", url: p[COL.url] });
    if (rep.ok) {
      props = props.filter((x) => cleLigne(x) !== cle);
      choisies.delete(cle);
      toast("Propriété retirée.");
      rendre();
    } else {
      bouton.classList.remove("confirme");
      bouton.textContent = "✕";
      toast("Échec : " + rep.erreur, true);
    }
  }

  // ---------- Rendu et événements ----------

  function rendre() {
    afficherStats();
    afficherTableau();
    afficherComparaison();
  }

  // Délégation : le tableau est réécrit à chaque tri, on n'attache
  // donc les écouteurs qu'une seule fois, sur le conteneur.
  $("#contenu").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-cle]");
    if (th && !th.classList.contains("fige")) {
      const cle = th.dataset.cle;
      const meta = COLONNES.find((c) => c.cle === cle);
      tri = tri.cle === cle
        ? { cle, sens: -tri.sens }
        : { cle, sens: meta.sens || 1 };
      $("#tri").value = ["cout", "cashflow", "mrb", "cap", "prix", "note", "date"].includes(cle) ? cle : "";
      afficherTableau();
      return;
    }

    const ligne = e.target.closest("tr[data-cle]");
    if (!ligne) return;

    if (e.target.classList.contains("pick")) {
      const cle = ligne.dataset.cle;
      if (e.target.checked) choisies.add(cle); else choisies.delete(cle);
      ligne.classList.toggle("choisie", e.target.checked);
      afficherComparaison();
      return;
    }

    if (e.target.classList.contains("retirer")) retirer(ligne, e.target);
  });

  $("#contenu").addEventListener("change", (e) => {
    if (e.target.classList.contains("editer")) {
      enregistrerNotes(e.target.closest("tr[data-cle]"));
    }
  });

  $("#contenu").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.classList.contains("editer")) e.target.blur();
  });

  $("#tri").addEventListener("change", () => {
    const cle = $("#tri").value;
    if (!cle) return;
    const meta = COLONNES.find((c) => c.cle === cle);
    tri = { cle, sens: cle === "date" ? -1 : (meta ? meta.sens : 1) };
    afficherTableau();
  });

  $("#recherche").addEventListener("input", (e) => {
    filtre = e.target.value;
    afficherTableau();
  });

  $("#comparer").addEventListener("click", () => {
    $("#comparaison").dataset.ouvert = "1";
    afficherComparaison();
    $("#comparaison").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  $("#export").addEventListener("click", exporterCSV);
  $("#refresh").addEventListener("click", charger);

  // ---------- Chargement ----------

  function charger() {
    $("#contenu").innerHTML = `<div class="message">Chargement de votre liste…</div>`;
    chrome.storage.sync.get({ sheetUrl: "" }, (s) => {
      sheetUrl = s.sheetUrl;
      if (!sheetUrl) {
        $("#contenu").innerHTML = `<div class="message">
          <b>Le tableau de bord n'est pas encore relié à votre liste.</b><br><br>
          Cliquez sur l'icône PlexCompare dans Chrome et collez l'URL de votre
          script Google (celle qui finit par <code>/exec</code>) — voir
          <code>INSTALLATION.md</code> pour la créer.
        </div>`;
        return;
      }

      chrome.runtime.sendMessage({ type: "pc-lire", url: sheetUrl }, (rep) => {
        if (chrome.runtime.lastError || !rep) {
          $("#contenu").innerHTML = `<div class="message"><b>Extension indisponible.</b><br><br>Recharge cette page.</div>`;
          return;
        }
        if (!rep.ok) {
          $("#contenu").innerHTML = `<div class="message">
            <b>Impossible de lire votre liste.</b><br><br>
            ${esc(rep.erreur)}<br><br>
            Si vous venez de mettre à jour <code>apps-script.gs</code>, il faut
            <b>redéployer</b> : Déployer → Gérer les déploiements → ✏️ Modifier
            → Version « Nouvelle version » → Déployer.
          </div>`;
          return;
        }

        const data = rep.data;
        if (!Array.isArray(data) || !data.length) {
          entetes = []; props = [];
        } else {
          entetes = data[0];
          props = data.slice(1).filter((l) => l[COL.url]);
        }
        // Une propriété supprimée ailleurs ne doit pas rester sélectionnée
        const existantes = new Set(props.map(cleLigne));
        choisies = new Set([...choisies].filter((c) => existantes.has(c)));
        rendre();
      });
    });
  }

  charger();
})();
