/* PlexCompare — popup des hypothèses.
   Les valeurs par défaut viennent de defaults.js : ne rien redéfinir ici. */

(() => {
  "use strict";

  const CHAMPS = {};
  for (const id of PC_CHAMPS_POPUP) CHAMPS[id] = PC_DEFAULTS[id];

  const $ = (id) => document.getElementById(id);
  const ok = $("ok");

  function dire(txt, erreur) {
    ok.textContent = txt;
    ok.className = erreur ? "erreur" : "";
  }

  chrome.storage.sync.get(CHAMPS, (s) => {
    for (const id in CHAMPS) {
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox") el.checked = !!s[id];
      else el.value = s[id];
    }
  });

  function lire() {
    const out = {};
    for (const id in CHAMPS) {
      const el = $(id);
      if (!el) continue;
      if (el.type === "checkbox") out[id] = el.checked;
      else if (el.type === "number") out[id] = parseFloat(el.value) || 0;
      else out[id] = el.value.trim();
    }
    return out;
  }

  $("save").addEventListener("click", () => {
    chrome.storage.sync.set(lire(), () => {
      dire("Enregistré ✓ — recharge la page Centris.");
      setTimeout(() => dire(""), 3000);
    });
  });

  // Le service worker fait une vraie requête : on peut enfin distinguer
  // un script mal déployé d'une URL erronée.
  $("tester").addEventListener("click", () => {
    const url = $("sheetUrl").value.trim();
    if (!url) return dire("Colle d'abord l'URL du script.", true);
    dire("Test en cours…");
    chrome.runtime.sendMessage({ type: "pc-lire", url }, (rep) => {
      if (chrome.runtime.lastError) {
        dire("Extension non disponible — rouvre le popup.", true);
      } else if (rep && rep.ok) {
        const lignes = Array.isArray(rep.data) ? Math.max(rep.data.length - 1, 0) : 0;
        dire(`Connexion réussie ✓ — ${lignes} propriété${lignes > 1 ? "s" : ""} sur la liste.`);
      } else {
        dire("Échec : " + ((rep && rep.erreur) || "inconnu"), true);
      }
    });
  });

  $("dash").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
})();
