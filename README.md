# PlexCompare

Extension Chrome qui calcule la rentabilité d'un plex **directement sur la fiche Centris** :
coût réel d'habitation, cashflow, MRB, taux de cap, DSCR, cash requis à la clôture.
Un bouton envoie la propriété vers une liste Google Sheets partagée, consultable dans un
tableau de bord intégré.

Pour l'installation et le mode d'emploi, voir **[INSTALLATION.md](INSTALLATION.md)**.

## Structure

| Fichier | Rôle |
|---|---|
| `manifest.json` | Déclaration de l'extension (MV3) |
| `defaults.js` | Hypothèses par défaut — **source unique de vérité**, chargée partout |
| `finance.js` | Moteur de calcul : barèmes SCHL, droits de mutation, hypothèque, indicateurs. Pur, sans DOM ni `chrome.*` |
| `content.js` | Lecture de la fiche Centris et panneau injecté |
| `background.js` | Service worker — toutes les requêtes vers Google Apps Script |
| `popup.html` / `popup.js` | Réglage des hypothèses |
| `dashboard.html` / `dashboard.js` | Tableau de bord : tri, filtre, notes, comparaison, export CSV |
| `panel.css` | Styles du panneau injecté et des badges |
| `apps-script.gs` | Code à coller dans Apps Script, côté Google Sheet |
| `tests.html` | Tests du moteur financier — à ouvrir dans le navigateur |

## Développer

```bash
git pull                       # récupérer les changements
# … modifier les fichiers …
```

Puis dans Chrome : `chrome://extensions` → bouton **↻** sur la carte PlexCompare,
et rechargez l'onglet Centris.

## Tester

Ouvrez `tests.html` dans le navigateur — 51 vérifications sur les barèmes, le calcul
hypothécaire et les scénarios. Le bandeau du haut passe au vert si tout passe.

Sans navigateur :

```bash
node --check finance.js        # syntaxe
```

## Chiffres à réviser chaque année

Les seuils fiscaux sont regroupés en haut de `finance.js` :

- `PALIERS_QC` / `PALIERS_MTL` — droits de mutation. Les deux premiers seuils sont
  **indexés chaque janvier** par Québec. Grille actuelle : 2026.
- `SCHL_OCCUPANT` — primes d'assurance prêt hypothécaire, 1 à 4 logements occupés.
- `PLAFOND_ASSURABLE` — 1 500 000 $ depuis décembre 2024.

## Avertissement

Outil d'aide à la décision, pas un conseil financier. Les chiffres finaux doivent être
validés par un courtier hypothécaire et un inspecteur en bâtiment.
