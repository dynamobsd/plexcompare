/* PlexCompare — tableau de bord
   Lit votre Google Sheet partagé (via doGet du script) et affiche
   toutes vos propriétés côte à côte, triables et codées par couleur. */

(() => {
  "use strict";

  const $ = (s) => document.querySelector(s);
  let props = [];

  const fmt = (n) =>
    n === "" || n == null || isNaN(n)
      ? "—"
      : Number(n).toLocaleString("fr-CA", { maximumFractionDigits: 0 }) + " $";

  const num = (v) => {
    const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
    return isFinite(n) ? n : null;
  };

  // Colonnes du Sheet (mêmes entêtes que apps-script.gs)
  const COL = {
    date: 0, adresse: 1, url: 2, prix: 3, unites: 4, revenus: 5,
    cout: 6, cashflow: 7, mrb: 8, cap: 9, hypo: 10, mdf: 11,
    bienvenue: 12, travaux: 13, cashTotal: 14, notes: 15, note: 16
  };

  function classe(v, bonSi, seuilBon, seuilMoyen) {
    if (v == null) return "";
    const ok = bonSi === "haut" ? v >= seuilBon : v <= seuilBon;
    const moyen = bonSi === "haut" ? v >= seuilMoyen : v <= seuilMoyen;
    return ok ? "good" : moyen ? "mid" : "bad";
  }

  function afficherStats() {
    const couts = props.map((p) => num(p[COL.cout])).filter((v) => v != null);
    const cash = props.map((p) => num(p[COL.cashflow])).filter((v) => v != null);
    const mrbs = props.map((p) => num(p[COL.mrb])).filter((v) => v != null);
    $("#stats").innerHTML = `
      <div class="stat"><b>${props.length}</b><span>propriétés sur votre liste</span></div>
      <div class="stat"><b>${couts.length ? fmt(Math.min(...couts)) : "—"}</b><span>meilleur coût d'habitation /mois</span></div>
      <div class="stat"><b>${cash.length ? fmt(Math.max(...cash)) : "—"}</b><span>meilleur cashflow /mois</span></div>
      <div class="stat"><b>${mrbs.length ? Math.min(...mrbs).toLocaleString("fr-CA", { maximumFractionDigits: 1 }) + "×" : "—"}</b><span>meilleur MRB</span></div>`;
  }

  function trier() {
    const mode = $("#tri").value;
    const cle = {
      cout: [COL.cout, 1], cashflow: [COL.cashflow, -1], mrb: [COL.mrb, 1],
      cap: [COL.cap, -1], prix: [COL.prix, 1], note: [COL.note, -1], date: [COL.date, -1]
    }[mode];
    props.sort((a, b) => {
      const va = mode === "date" ? String(a[cle[0]]) : num(a[cle[0]]);
      const vb = mode === "date" ? String(b[cle[0]]) : num(b[cle[0]]);
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : va > vb ? 1 : 0) * cle[1];
    });
  }

  function afficherTableau() {
    if (!props.length) {
      $("#contenu").innerHTML = `<div class="message">
        <b>Votre liste est vide pour l'instant.</b><br><br>
        Ouvrez une fiche de plex sur Centris et cliquez
        <b>＋ Ajouter à notre liste</b> — elle apparaîtra ici.
      </div>`;
      return;
    }

    trier();

    const lignes = props.map((p, i) => {
      const cout = num(p[COL.cout]), cf = num(p[COL.cashflow]);
      const mrb = num(p[COL.mrb]), cap = num(p[COL.cap]);
      const note = num(p[COL.note]);
      return `
      <tr class="${i === 0 ? "meilleur" : ""}">
        <td class="adresse">
          <a href="${p[COL.url]}" target="_blank" title="Ouvrir la fiche Centris">${p[COL.adresse] || "Fiche Centris"}</a>
          ${i === 0 ? '<span class="badge-top">№ 1</span>' : ""}
        </td>
        <td>${fmt(num(p[COL.prix]))}</td>
        <td>${p[COL.unites] || "—"}</td>
        <td>${fmt(num(p[COL.revenus]))}</td>
        <td class="${classe(cout, "bas", 1200, 2200)}">${fmt(cout)}</td>
        <td class="${classe(cf, "haut", 0, -500)}">${fmt(cf)}</td>
        <td class="${classe(mrb, "bas", 15, 19)}">${mrb != null ? mrb.toLocaleString("fr-CA", { maximumFractionDigits: 1 }) + "×" : "—"}</td>
        <td>${cap != null ? cap.toLocaleString("fr-CA", { maximumFractionDigits: 2 }) + " %" : "—"}</td>
        <td>${fmt(num(p[COL.cashTotal]))}</td>
        <td class="${note != null && note >= 8 ? "good" : ""}">${note != null ? note + "/10" : "—"}</td>
        <td class="notes">${p[COL.notes] || ""}</td>
      </tr>`;
    }).join("");

    $("#contenu").innerHTML = `
      <div class="wrap"><table>
        <thead><tr>
          <th>Propriété</th><th>Prix</th><th>Unités</th><th>Revenus/an</th>
          <th>Coût habitation</th><th>Cashflow</th><th>MRB</th><th>Cap</th>
          <th>Cash requis</th><th>Note</th><th>Nos notes</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table></div>`;
  }

  async function charger() {
    $("#contenu").innerHTML = `<div class="message">Chargement de votre liste…</div>`;
    chrome.storage.sync.get({ sheetUrl: "" }, async ({ sheetUrl }) => {
      if (!sheetUrl) {
        $("#contenu").innerHTML = `<div class="message">
          <b>Le tableau de bord n'est pas encore relié à votre liste.</b><br><br>
          Cliquez sur l'icône PlexCompare dans Chrome et collez l'URL de votre
          script Google (celle qui finit par <code>/exec</code>) — voir
          <code>INSTALLATION.md</code> pour la créer.
        </div>`;
        return;
      }
      try {
        const rep = await fetch(sheetUrl, { method: "GET" });
        const data = await rep.json();
        props = Array.isArray(data) ? data.slice(1).filter((l) => l[COL.url]) : [];
        afficherStats();
        afficherTableau();
      } catch (err) {
        $("#contenu").innerHTML = `<div class="message">
          <b>Impossible de lire votre liste.</b><br><br>
          Si vous venez de mettre à jour le fichier <code>apps-script.gs</code>,
          il faut <b>redéployer</b> le script : Déployer → Gérer les déploiements
          → ✏️ Modifier → Version « Nouvelle version » → Déployer.
        </div>`;
        console.warn("PlexCompare dashboard :", err);
      }
    });
  }

  $("#refresh").addEventListener("click", charger);
  $("#tri").addEventListener("change", afficherTableau);
  charger();
})();
