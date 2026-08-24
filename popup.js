const CHAMPS = {
  tauxHypo: 4.79,
  amortissement: 25,
  entretienPct: 5,
  vacancePct: 3,
  assurancesAn: 3000,
  deneigementAn: 800,
  loyerUniteOccupee: 0,
  villeMontreal: true,
  sheetUrl: ""
};

chrome.storage.sync.get(CHAMPS, (s) => {
  for (const id in CHAMPS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!s[id];
    else el.value = s[id];
  }
});

document.getElementById("save").addEventListener("click", () => {
  const out = {};
  for (const id in CHAMPS) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === "checkbox") out[id] = el.checked;
    else if (el.type === "number") out[id] = parseFloat(el.value) || 0;
    else out[id] = el.value.trim();
  }
  chrome.storage.sync.set(out, () => {
    const ok = document.getElementById("ok");
    ok.textContent = "Enregistré ✓ — recharge la page Centris.";
    setTimeout(() => (ok.textContent = ""), 3000);
  });
});

document.getElementById("dash").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
