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
| `maj.cmd` | Mise à jour en un double-clic |

## Développer

Modifiez les fichiers, puis dans Chrome : `chrome://extensions` → bouton **↻**
sur la carte PlexCompare, et rechargez l'onglet Centris.

Le dossier chargé par Chrome étant le dépôt lui-même, une modification est
visible immédiatement après le rechargement — aucun empaquetage nécessaire.

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

## Installation et mise à jour

L'extension se charge **non empaquetée**, directement depuis ce dossier.

`chrome://extensions` → **Mode développeur** → **Charger l'extension non
empaquetée** → choisir le dossier du dépôt.

Le champ `key` du manifeste fixe l'identifiant de l'extension
(`lfibmbaifoddfiaophkjbhfgeenialjc`). Sans lui, Chrome dériverait l'ID du
chemin du dossier : déplacer le dépôt ferait perdre tous les réglages
enregistrés. Ne pas le retirer.

### Mettre à jour

Double-cliquer sur **`maj.cmd`**. Il récupère la dernière version, ouvre
`chrome://extensions` et il ne reste qu'à cliquer le bouton de rechargement
sur la carte PlexCompare. Fermer et rouvrir Chrome produit le même effet.

### Pourquoi pas de mise à jour automatique

Google réserve l'installation automatique d'extensions hébergées hors du
Chrome Web Store aux postes joints à un domaine Active Directory ou inscrits
en gestion d'entreprise. Sur un poste personnel, Chrome ignore purement et
simplement la politique `ExtensionSettings`, quoi qu'on écrive dans le
registre — vérifié sur ce poste : politique correctement inscrite, profil
neuf, aucune tentative d'installation dans le journal de Chrome.

La seule voie offrant une vraie mise à jour automatique sur un poste non géré
est le Chrome Web Store en publication **non répertoriée** (5 $ une fois,
extension non cherchable, installation par lien privé). Cette option reste
ouverte : le code est prêt, il ne manquerait qu'un zip et un téléversement.

> Ne jamais installer le `.crx` par glisser-déposer dans `chrome://extensions`.
> Chrome l'accepte puis le désactive définitivement, sans possibilité de
> réactivation.
