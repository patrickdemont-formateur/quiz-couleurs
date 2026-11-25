# Questionnaire Couleurs – V2 : guide de mise en place, d'usage et de test

## 1. Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | Page PARTICIPANT (accès par QR code : `index.html?g=CODE`) |
| `formateur.html` | Page FORMATEUR (aucun lien depuis la page participant, `noindex`) |
| `css/style.css` | Style V1 conservé + ajouts V2 |
| `js/core.js` | Calcul (V1 inchangé), analyse, radar, histogramme, appels serveur |
| `js/participant.js`, `js/formateur.js` | Logique des deux interfaces |
| `js/config.js` | **URL du serveur Apps Script à renseigner** (aucun secret) |
| `js/vendor-qrcode.js` | Générateur de QR code (MIT, hébergé localement : aucune dépendance externe) |
| `data/questions.json` | Questionnaire V1, **strictement inchangé** (36 questions, échelle et points identiques) |
| `gas/Code.gs`, `gas/appsscript.json` | Serveur Google Apps Script (à copier dans Apps Script) |
| `tools/generer-mapping.js` | Régénère le bloc « QUESTIONS » de `Code.gs` si vous modifiez le questionnaire |
| `tests/`, `package.json` | Tests automatisés (développement uniquement) |

## 2. Où sont les données

| Donnée | Lieu | Durée |
|---|---|---|
| Nom du groupe, code, date de création, statut | Feuille Google Sheets « Groupes » | Conservées (administratif) |
| Prénom, identifiant, réponses, scores, empreinte du jeton | **PropertiesService** du script (pas d'historique de versions) | Lecture refusée 7 jours après l'inscription, suppression physique à la purge |
| Jeton secret + code groupe | `localStorage` du téléphone du participant | Jusqu'à expiration détectée ou bouton « Effacer mes données » |
| Brouillon des réponses | `localStorage` du téléphone | Effacé dès l'envoi réussi |

Le jeton secret n'est jamais stocké en clair côté serveur (empreinte SHA-256). L'identifiant technique visible par le formateur (`P-4821`) ne donne accès à rien.

**Calendrier réel de suppression** : à J+7 après l'inscription, le serveur refuse toute lecture. La suppression physique est faite par le déclencheur hebdomadaire (lundi, vers 3 h), ou plus tôt à l'ouverture de l'espace formateur. Pire cas : environ 14 jours après l'inscription pour la suppression physique, sans accès possible dès J+7. Pour resserrer, remplacer dans `installer()` le déclencheur hebdomadaire par `.everyDays(1).atHour(3)`.

## 3. Mise en place Google Apps Script (une seule fois)

1. Créez (ou ouvrez) un Google Sheets dédié, par exemple « Questionnaire Couleurs – groupes ».
2. **Extensions > Apps Script**. Remplacez le contenu de `Code.gs` par celui de `gas/Code.gs`.
3. **Paramètres du projet** : cochez « Afficher le fichier manifeste appsscript.json » et collez le contenu de `gas/appsscript.json`.
4. **Paramètres du projet > Propriétés du script > Ajouter** : nom `ADMIN_KEY`, valeur = votre clé formateur (longue, difficile à deviner).
5. Dans l'éditeur, exécutez la fonction **`installer()`** et acceptez les autorisations (Sheets, déclencheurs, envoi d'e-mail d'alerte). Elle crée la feuille « Groupes » et le déclencheur hebdomadaire.
6. Exécutez **`testerPurge()`** : le journal doit indiquer « TEST PURGE : RÉUSSI ».
7. **Déployer > Nouveau déploiement > Application Web** : *Exécuter en tant que* **Moi**, *Qui a accès* **Tout le monde**. Copiez l'URL qui se termine par `/exec`.
8. Pour toute modification ultérieure du script : **Déployer > Gérer les déploiements > modifier > Nouvelle version** (l'URL reste la même).

## 4. Mise en place GitHub Pages

1. Ouvrez `js/config.js` et remplacez `API_URL` par l'URL `/exec`.
2. Déposez tout le dossier (hors `tests/` si vous préférez) dans votre dépôt GitHub Pages.
3. Le dépôt est public : n'y placez jamais votre clé formateur.

## 5. Utilisation en séance

1. Ouvrez `formateur.html`, saisissez votre clé, cliquez **Nouveau groupe**.
2. Projetez le QR code (bouton « Agrandir pour projeter ») ; le code à 6 caractères sert de secours. Activez « Masquer les prénoms » si l'écran est visible du groupe.
3. Les participants scannent, lisent la notice, saisissent leur prénom, répondent et envoient. Le tableau de bord passe à « Complet » (actualisation manuelle ou toutes les 30 s).
4. Cliquez sur une ligne : profil, calcul vérifié, et **réponse par réponse** (préférence A/B, intensité, couleur, points) pour préparer le débriefing individuel.
5. Menez vos échanges, puis **débloquez** individuellement ou en bloc. Le participant clique sur « Vérifier si ma synthèse est disponible ».
6. Fermez les inscriptions une fois le groupe complet. En fin de séance : « Effacer maintenant les données individuelles » si vous ne voulez pas attendre l'expiration.

Phrase à dire aux participants : *« Vos réponses ne sont ni archivées ni transmises à quiconque. Je les consulte pour animer le débriefing, puis elles sont supprimées automatiquement au bout de 7 jours. »*

## 6. Procédure de test (à faire sur votre déploiement réel)

Les tests automatisés valident la logique sur un Apps Script **simulé**. Il reste à confirmer, sur le vrai déploiement et de vrais téléphones, les points marqués ★.

| N° | Test | Résultat attendu |
|---|---|---|
| 1 ★ | Ouvrir `formateur.html`, clé erronée puis correcte | Refus puis accès ; au bout de 8 échecs, blocage de 10 min |
| 2 ★ | Créer 2 groupes | Noms `AAAA-MM-JJ – Groupe 1` et `… Groupe 2`, codes différents, QR affiché |
| 3 ★ | Scanner le QR avec un téléphone en 4G (hors Wi-Fi) | Page d'inscription du bon groupe (valide aussi l'appel GitHub Pages → Apps Script) |
| 4 ★ | Inscrire 3 téléphones, dont deux avec le même prénom | « Marie » et « Marie (2) » ; les trois apparaissent chez le formateur |
| 5 | Inscrire le même prénom dans l'autre groupe | Pas de suffixe |
| 6 ★ | Répondre à 36 questions sur un téléphone, couper le réseau au moment d'envoyer | Message explicite, réponses conservées ; « Réessayer » fonctionne sans doublon |
| 7 | Comparer le profil affiché au calcul manuel de 2 jeux de réponses | Scores identiques, mention « Calcul vérifié » chez le formateur |
| 8 ★ | Avant déblocage, rouvrir la page participant | Aucune synthèse, aucun score |
| 9 | Débloquer un participant, puis tous | Seuls les participants complets sont débloqués ; radar + histogramme visibles |
| 10 ★ | Depuis le téléphone A, tenter de voir la synthèse de B (identifiant seul, sans jeton) | Impossible |
| 11 | Ouvrir le détail d'un participant | 36 lignes de réponses, couleurs et points |
| 12 | Archiver, réactiver, fermer/rouvrir les inscriptions, supprimer un groupe | Comportements décrits à l'écran ; la suppression efface aussi les participants |
| 13 ★ | `testerPurge()` dans Apps Script | « RÉUSSI » |
| 14 ★ | `verifierPurge()` après quelques jours | Déclencheur présent, dernière purge récente, 0 expiré restant |
| 15 ★ | Après le premier lundi suivant une séance de test | Bandeau vert « Purge automatique en service » dans l'espace formateur |
| 16 | Aucune activité pendant 8 jours puis réouverture du lien participant | « Données supprimées », jeton local effacé |

Tests automatisés (optionnel) : `npm install` puis `npm test` (40 tests serveur, 8 de parité de calcul, 26 de bout en bout).

## 7. Modifier le questionnaire

1. Éditez `data/questions.json` (et incrémentez `version`).
2. Lancez `node tools/generer-mapping.js` et remplacez dans `gas/Code.gs` le bloc compris entre `=== BLOC GÉNÉRÉ ===` et `=== FIN DU BLOC GÉNÉRÉ ===`.
3. Redéployez une nouvelle version du script, puis lancez `npm test` (le test de parité détecte tout écart client/serveur).
4. Les résultats de séances différentes ne sont comparables que s'ils reposent sur la même version.

## 8. Limites connues

- Le serveur ne peut pas empêcher un participant de conserver une capture d'écran ou un PDF : la notice l'indique.
- Le quota de `PropertiesService` (environ 500 Ko) suffit pour plusieurs centaines de participants simultanés ; `Code.gs` plafonne à 800 enregistrements et 60 par groupe.
- Une seule clé formateur pour l'instant (expérimentation) : toute personne qui la connaît a accès à tous les groupes.
- Les journaux d'exécution Apps Script ne contiennent aucune donnée saisie (le code n'en écrit pas). Ne rajoutez jamais de `Logger.log` sur des prénoms, réponses ou scores.
- Aucune mise en page n'a pu être contrôlée dans un navigateur réel pendant le développement : vérifiez l'affichage sur smartphone (test 3 et suivants).
