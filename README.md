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

## Distribution et mise à jour automatique

L'extension est signée et distribuée hors du Chrome Web Store, via GitHub.
Chrome interroge `updates.xml` environ toutes les 5 heures et installe seul
toute version supérieure à celle en place.

| Élément | Valeur |
|---|---|
| ID de l'extension | `lfibmbaifoddfiaophkjbhfgeenialjc` |
| Manifeste de mise à jour | `https://dynamobsd.github.io/plexcompare/updates.xml` |
| Paquets | Releases GitHub, tag `v<version>` |
| Clé de signature | `~/.plexcompare-signing/plexcompare.pem` — **hors du dépôt, à sauvegarder** |

> Si la clé est perdue, l'ID de l'extension change : il faut refaire la
> politique de registre et réinstaller sur chaque poste. Les réglages
> enregistrés dans `chrome.storage.sync` seraient perdus avec elle.

### Publier une nouvelle version

```powershell
# 1. Monter le numéro de version dans manifest.json
# 2. Vérifier que tests.html passe au vert
.\build.ps1 -Publier
```

Le script fabrique le `.crx` signé, régénère `updates.xml`, pousse le dépôt
et crée la release GitHub. Chrome fera le reste. Pour forcer tout de suite :
`chrome://extensions` → **Tout mettre à jour**.

### Installer sur un poste

Exécuter `deploiement/installer-plexcompare.reg` en administrateur, Chrome
fermé. Le fichier écrit une seule clé de politique dans `HKEY_LOCAL_MACHINE`
qui dit à Chrome d'installer l'extension (`force_installed`) et où chercher
ses mises à jour. Ne jamais installer le `.crx` par glisser-déposer : Chrome
bloque définitivement les extensions installées ainsi hors du Web Store.
`desinstaller-plexcompare.reg` annule l'opération.

Cette voie exige que `updates.xml` et le `.crx` soient **accessibles
publiquement** : Chrome ne peut pas s'authentifier auprès d'un dépôt privé.
