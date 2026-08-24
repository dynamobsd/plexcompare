# PlexCompare — Guide d'installation

Extension Chrome qui affiche automatiquement la rentabilité des plex directement sur les fiches Centris, avec un bouton pour envoyer vos coups de cœur vers une liste Google Sheets partagée entre vous deux.

## 1. Installer l'extension (2 min, chacun sur son ordi)

1. Placez le dossier `plexcompare` quelque part de permanent (pas dans Téléchargements — si le dossier bouge, l'extension se désactive). Sur cet ordinateur : `C:/Users/Sidney/plexcompare`, suivi par git.
2. Ouvrez Chrome et allez à `chrome://extensions`.
3. Activez le **Mode développeur** (coin supérieur droit).
4. Cliquez **Charger l'extension non empaquetée** et choisissez le dossier `plexcompare`.
5. Épinglez l'icône PlexCompare dans la barre d'outils (icône casse-tête → punaise).

## 2. Créer la liste partagée (5 min, une seule personne)

1. Créez un Google Sheet vide, nommez-le « Nos plex », et partagez-le avec votre conjoint(e) en accès **Éditeur**.
2. Dans le Sheet : **Extensions → Apps Script**.
3. Effacez le code par défaut et collez tout le contenu du fichier `apps-script.gs`, puis enregistrez.
4. **Déployer → Nouveau déploiement** → type **Application Web** :
   - Exécuter en tant que : **Moi**
   - Qui a accès : **Tout le monde**
5. Autorisez l'accès quand Google le demande, puis copiez l'**URL qui se termine par `/exec`**.
6. Envoyez cette URL à votre conjoint(e).
7. Collez-la dans le popup de l'extension et cliquez **Tester la connexion** : le message vous dit exactement ce qui cloche si ça ne marche pas.

> **Après chaque modification de `apps-script.gs`**, il faut redéployer : Déployer → Gérer les déploiements → ✏️ Modifier → Version « Nouvelle version » → Déployer. Sinon Google continue de servir l'ancienne version.

## 3. Configurer vos hypothèses (1 min, chacun)

Cliquez sur l'icône PlexCompare dans Chrome et remplissez :

- **Taux hypothécaire** : le taux que votre courtier vous a préapprouvé.
- **Loyer de votre unité** : la valeur locative approximative du logement que vous habiteriez (sert au calcul du coût réel d'habitation).
- **URL du script Google** : collez l'URL `/exec` de l'étape 2 — la même pour vous deux.
- Le reste (entretien, vacance, assurances) a des valeurs par défaut raisonnables que vous pouvez ajuster.

Cliquez **Enregistrer**.

## 4. Utiliser

- Ouvrez n'importe quelle fiche de duplex/triplex sur **centris.ca** : le panneau apparaît automatiquement à droite avec le coût réel d'habitation, le cashflow, le MRB, le taux de cap et le cash requis à la clôture.
- Les données extraites sont **modifiables** directement dans le panneau (utile si Centris affiche des loyers sous le marché, ou pour ajouter un estimé de travaux après une visite).
- Cliquez **＋ Ajouter à notre liste** : la propriété s'ajoute au Sheet partagé avec tous les chiffres. Si vous la renvoyez plus tard, la ligne existante est mise à jour plutôt que dupliquée.
- Dans les résultats de recherche, un badge **MRB** apparaît sur les vignettes quand Centris affiche les revenus (vert ≤ 15×, jaune ≤ 19×, rouge au-delà).
- Dans le Sheet, deux colonnes vous attendent pour vos impressions de visite : **Nos notes** et **Note /10**.

## Notes et limites

- **Si Centris change son site**, l'extraction automatique peut cesser de fonctionner. Le panneau reste utilisable en mode manuel (tapez les chiffres), et le code d'extraction se répare facilement — revenez me voir avec l'exemple d'une fiche qui ne marche plus.
- **Taxe de bienvenue** : grille officielle **2026** (Montréal ou base provinciale selon la case cochée), vérifiée contre l'exemple publié par la Ville (700 000 $ → 9 349 $). Les deux premiers seuils sont indexés chaque année : ils sont en haut de `finance.js` (constantes `PALIERS_QC` et `PALIERS_MTL`), à réviser chaque janvier.
- **Mise de fonds minimale** : règles propriétaire-occupant (5 % duplex jusqu'à 500 k$, 10 % triplex/quadruplex, 20 % au-dessus du plafond assurable de 1,5 M$), prime SCHL ajoutée au prêt et taxe de 9 % sur la prime comptée dans le cash requis. La SCHL applique le **même barème de 1 à 4 logements** quand vous occupez une unité (4,00 % / 3,10 % / 2,80 % selon le rapport prêt-valeur), plus **0,20 % si l'amortissement dépasse 25 ans**. C'est un estimé — validez toujours avec votre courtier.
- **Tests** : ouvrez `tests.html` dans le navigateur après toute modification de `finance.js`. 51 vérifications couvrent les barèmes, l'hypothèque et les scénarios.
- Les calculs sont des outils d'aide à la décision, pas des conseils financiers : faites valider les chiffres finaux par votre courtier hypothécaire et votre inspecteur.

## Nouveau dans la version 1.1

- **Vos ajustements sont mémorisés.** Corrigez les loyers réels ou ajoutez un estimé de travaux : en revenant sur la fiche demain, tout est encore là. Un bandeau indique la date du dernier ajustement, avec un bouton **Réinitialiser**. Seuls les champs que vous avez tapés sont conservés — si Centris met le prix à jour, c'est le nouveau prix qui s'affiche.
- **Chip « Je n'y habite pas »** : bascule en mode investisseur — 20 % comptant, prêt conventionnel sans SCHL, vacance sur tous les logements, et le cashflow devient le chiffre principal.
- **Revenus annexes** : nouveau champ pour le stationnement, la buanderie ou le rangement.
- **Vacance plus juste** : elle ne s'applique plus au logement que vous habitez — vous n'y perdez pas de loyer.
- **Frais de clôture paramétrables** : notaire, inspection et fonds de démarrage se règlent dans le popup au lieu d'être figés à 2 000 $.
- **Le message d'envoi ne ment plus.** L'ancienne version affichait « Ajoutée ✓ » même quand le script Google répondait une erreur. L'envoi passe maintenant par le service worker, qui lit la vraie réponse et affiche la vraie cause de l'échec.
- **Tableau de bord éditable** : notes et note /10 se modifient directement, suppression d'une ligne, filtre par adresse, tri en cliquant les entêtes, export CSV et **comparaison côte à côte** de plusieurs propriétés (la meilleure valeur de chaque ligne est étoilée).
- **Page nettement plus légère.** L'extension relançait un balayage complet du DOM à chaque frappe au clavier et toutes les 3 secondes en permanence. Elle ne balaie plus que ce qui manque encore, une seule fois.
- **Plus de fiches reconnues** : quintuplex, sextuplex, immeubles à revenus.

## Nouveau dans la version 1.0

- **Section intégrée dans la fiche** : le tableau de rentabilité s'insère directement dans la page Centris, sous le bloc du prix (comme Keepa sur Amazon), au lieu d'un panneau flottant. Si la structure de la page empêche l'insertion, l'extension retombe automatiquement sur un panneau flottant à droite.
- **Historique de prix** : à chaque visite d'une fiche, le prix est mémorisé localement. Si le vendeur change son prix, une ligne « Historique du prix observé » apparaît avec les dates et la variation (▼ en vert pour une baisse). L'historique commence au moment où vous visitez la fiche pour la première fois — l'extension ne peut pas connaître les prix d'avant son installation.

## Version « béton »

- **Extraction à trois couches** : données structurées (JSON-LD) du code de la page d'abord, puis balises meta, puis balayage du texte visible. Si Centris charge les caractéristiques après coup, l'extension retente automatiquement de remplir les champs encore vides — sans jamais écraser un chiffre que vous avez tapé.
- **Champs manquants surlignés en orange** : si un chiffre essentiel n'a pas été trouvé, le formulaire s'ouvre et le champ à compléter est mis en évidence, avec un message clair.
- **Scénarios « Et si? »** : trois boutons recalculent tout instantanément — Taux +1,5 % (test de résistance), Mise de fonds 20 % (élimine la prime SCHL), et Loyers au marché (remplissez le champ « Revenus au marché / an » avec votre estimé du potentiel réel). Combinables entre eux.
- **Navigation suivie** : si vous passez d'une fiche à l'autre sans recharger la page, le panneau se reconstruit avec les données de la nouvelle fiche.
- **Aucune panne silencieuse** : toute erreur est attrapée et n'affecte jamais l'affichage de la page Centris; au pire, le panneau reste en mode manuel.

## Version professionnelle

- **Ratios de niveau investisseur dans le panneau** : DSCR (ratio de couverture de la dette — les banques exigent généralement ≥ 1,10 en locatif; vert à 1,20+), cash-on-cash (rendement annuel du cashflow sur l'argent réellement investi) et prix par porte (le comparatif de base entre plex de tailles différentes).
- **Tableau de bord de comparaison** : cliquez « 📊 Ouvrir notre tableau de bord » dans le popup de l'extension. La page lit votre Google Sheet et affiche toutes vos propriétés : sommaire en haut (meilleur coût, meilleur cashflow, meilleur MRB), tableau triable par 7 critères, code couleur, badge « № 1 » sur la meilleure selon le tri choisi, liens directs vers les fiches Centris, et vos colonnes « Nos notes » et « Note /10 » remplies dans le Sheet.
- **⚠️ Si vous aviez déjà déployé le script Google** : recollez le nouveau `apps-script.gs` (il ajoute la fonction de lecture `doGet`), puis **Déployer → Gérer les déploiements → ✏️ → Version « Nouvelle version » → Déployer**. Sans cette étape, le tableau de bord ne pourra pas lire la liste.

## Version « fiche d'agent »

Le panneau est maintenant une fiche sommaire complète, comme celle qu'un agent d'immeuble vous préparerait :
- **Bande d'identité en tête** : adresse, détail des unités (ex. 3 x 5 ½), année de construction, style de bâtiment, superficie du terrain.
- **Prix vs évaluation municipale** : l'écart en % s'affiche à côté du prix demandé (vert ≤ +10 %, jaune ≤ +30 %, rouge au-delà) — le premier réflexe d'un agent pour juger si le prix est gonflé.
- **Grille enrichie** : taxes totales annuelles et loyer moyen par porte s'ajoutent aux indicateurs financiers.
- 47 tests automatisés passent (calculs de référence, extraction sur structure Centris réelle, panneau, scénarios, badge, historique de prix).

## Propriétaire-occupant par défaut

L'outil assume maintenant d'office que vous habiterez un des logements — c'est votre projet, et c'était d'ailleurs une correction nécessaire : l'ancien calcul pouvait compter le loyer du logement que vous occupez comme un revenu. Concrètement :
- Si vous ne précisez pas la valeur de votre unité, elle est estimée au **loyer moyen par porte** (revenus ÷ nombre d'unités) et automatiquement retirée des loyers perçus.
- Le grand chiffre indique clairement l'hypothèse : « en habitant une unité (la vôtre estimée à X $/mois), loyers des 2 autres déduits ».
- Pour un calcul exact, entrez la vraie valeur locative de l'unité visée dans « Loyer de votre unité / mois » (souvent la plus grande ou la plus rénovée — donc au-dessus de la moyenne).
- Le « Cashflow si un jour tout est loué » reste affiché comme scénario futur, pour le jour où vous déménagerez et louerez tout l'immeuble.

## Répartition des loyers par taille d'unité

Puisque vous prendrez la plus grande unité, l'outil estime maintenant le loyer de chaque logement individuellement :
- Le détail des unités de la fiche (ex. « 1 x 3 ½, 2 x 5 ½ ») est lu automatiquement et les revenus totaux sont répartis **au prorata de la taille** de chaque logement — un 5½ vaut plus qu'un 3½.
- **Par défaut, votre unité = la plus grande.** Les loyers perçus dans le calcul du coût d'habitation sont donc ceux des plus petites unités, ce qui est plus réaliste (et plus prudent) que l'ancienne moyenne par porte.
- Une ligne « Loyers estimés par taille » s'affiche sous les scénarios quand les unités diffèrent : ex. « 5½ ≈ 1 551 $ (vous) · 5½ ≈ 1 551 $ · 3½ ≈ 987 $ ». Elle est masquée quand toutes les unités sont identiques (la moyenne suffit alors).
- Le champ « Loyer de votre unité / mois » garde priorité si vous entrez une valeur exacte après une visite.
- Note : la répartition au prorata des pièces est un estimé — l'état, l'étage et les rénovations font varier les vrais loyers. Les baux réels obtenus du courtier restent la référence avant une offre.
