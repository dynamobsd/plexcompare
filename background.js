/* ============================================================
   PlexCompare — service worker
   Toutes les requêtes vers le script Google passent par ici.

   Pourquoi : un fetch lancé depuis le content script est soumis au
   CORS de centris.ca. L'ancienne version contournait ça avec
   mode:"no-cors", qui rend la réponse opaque — l'extension affichait
   « Ajoutée ✓ » même quand le script répondait une erreur. Depuis le
   service worker, les host_permissions s'appliquent : vraie requête,
   vrai code de retour, vrai message d'erreur.
   ============================================================ */

const HOTES_AUTORISES = /^https:\/\/script\.(google|googleusercontent)\.com\//;

async function appelerScript(url, payload) {
  if (!HOTES_AUTORISES.test(url || "")) {
    return { ok: false, erreur: "l'URL doit commencer par https://script.google.com/" };
  }

  let rep;
  try {
    rep = payload
      ? await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify(payload),
          redirect: "follow"
        })
      : await fetch(url, { method: "GET", redirect: "follow" });
  } catch (err) {
    return { ok: false, erreur: "réseau injoignable (" + err.message + ")" };
  }

  if (!rep.ok) {
    return { ok: false, erreur: "le script a répondu " + rep.status };
  }

  const texte = await rep.text();

  // Apps Script renvoie une page HTML de connexion quand le déploiement
  // n'est pas accessible à « Tout le monde ».
  if (/^\s*</.test(texte)) {
    return {
      ok: false,
      erreur: "le déploiement n'est pas public — remets « Qui a accès : Tout le monde »"
    };
  }

  let data;
  try {
    data = JSON.parse(texte);
  } catch {
    return { ok: false, erreur: "réponse illisible du script (redéploie-le)" };
  }

  if (data && data.ok === false) {
    return { ok: false, erreur: data.erreur || "erreur du script" };
  }
  return { ok: true, data, miseAJour: !!(data && data.miseAJour) };
}

chrome.runtime.onMessage.addListener((msg, _expediteur, repondre) => {
  if (!msg || typeof msg.type !== "string") return;

  if (msg.type === "pc-envoyer") {
    appelerScript(msg.url, msg.payload).then(repondre);
    return true; // réponse asynchrone
  }

  if (msg.type === "pc-lire") {
    appelerScript(msg.url, null).then(repondre);
    return true;
  }
});
