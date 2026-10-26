# Passation de session — Family Tree

**Date :** 25 octobre 2026
**Dépôt local :** `C:\Users\François\Documents\family-tree`
**Branche de travail :** `recette`
**Objet immédiat :** clôturer la session en cours et reprendre dans une nouvelle session sans perdre l’état du projet, ses conventions ni le travail local sur la visionneuse de documents.

> Ce document est un état de passation écrit. Il ne remplace pas l’historique complet de l’interface de conversation, mais consigne les décisions, l’architecture, les contraintes et les actions nécessaires pour reprendre proprement.

## Instruction de reprise pour la prochaine session

Commencer par lire `AGENTS.md`, puis ce document et l’état réel du dépôt (`git status --short --branch`, `git diff`). Travailler sur `recette` uniquement. Les modifications de cette session sont locales et **ne sont ni commitées ni publiées**. Ne pas les écraser ni supprimer les fichiers non suivis listés ci-dessous. Avant toute modification ou publication, confirmer avec François ce qu’il souhaite faire ensuite.

Pour reprendre d’abord le chantier en cours : relire intégralement les changements de la visionneuse, lancer les vérifications indiquées plus bas après toute retouche, puis organiser une comparaison visuelle avec un même document réel autorisé et, si possible, Safari sur iPhone. Les résultats Playwright actuels sont synthétiques : ils ne prouvent pas la qualité d’un document réel ni l’équivalence avec le site déployé.

## Projet et architecture

Application familiale de généalogie en **JavaScript vanilla**, sans framework ni outil de compilation traditionnel. Application monopage servie comme fichiers statiques, déployée sur GitHub Pages. Interface, documentation et tests sont en français.

### Fichiers et modules importants

- `index.html` : page unique, markup et CSS de mise en page inline, référence `css/design-system.css`, puis charge les modules UI et `js/app.js`.
- `js/app.js` : point d’entrée historique conséquent. Initialise Firebase/authentification et gère notamment arbre, répertoire, documents, tâches, fiches personnes, archives, administration et sauvegarde/restauration.
- `css/design-system.css` : tokens et composants CSS partagés. Utiliser les tokens existants pour le nouveau CSS.
- `js/tree-layout.js`, `js/tree-renderer.js`, `js/tree-camera.js` : calcul, rendu et caméra de l’arbre généalogique.
- Autres modules de logique réutilisable : `family-relations.js`, `genealogy-date.js`, `directory-utils.js`, `document-utils.js`, `ui-components.js`, `form-ui.js`, `location-autocomplete.js`, `place-format.js`.
- `firestore.rules` : règles publiées séparément dans Firebase Console, sensibles et versionnées. Ce fichier est explicitement gelé par des fixtures/tests historiques ; ne pas le modifier sans demande et justification explicites.
- `tests/` : scripts Node et `node:test`; certains contrôles UI utilisent Playwright. Les fixtures `tests/fixtures/v16`, `v17`, `v18` sont historiques et ne doivent jamais être actualisées pour faire passer un test.
- Documentation racine : spécifications et rapports QA par fonctionnalité.

### Backend et modèle de données

- Firebase Firestore et Firebase Auth. Pas de Cloud Functions, pas de Firebase Storage. Firebase JS SDK v12 importé depuis `gstatic`; JSZip est chargé à la demande pour backup/restore.
- Collections : `people`, `families`, `documents`, `tasks`, `users`; document d’amorçage `settings/access`.
- Les fichiers sont stockés dans Firestore en `Bytes` et morceaux (limite document 20 MB, morceaux de 700 KB), pas dans Storage.
- La base de production contient de vraies données généalogiques : la traiter en lecture seule. Jamais de test, reset, migration ou écriture de production sans demande explicite et précisément autorisée.
- Compatibilité historique obligatoire : chaînes `birthDate`/`deathDate`, `partnerIds`/`childIds`, `marriedName`, lieux sous forme de texte. Dates structurées dans les champs `*Info`, sans inventer de date précise à partir d’une année seule. `lastName` reste le nom de naissance.
- Les suggestions GeoNames sont facultatives ; la saisie libre doit toujours fonctionner.

## Contraintes de travail essentielles

1. **Recette → production.** Commencer sur `recette`; ne pas développer directement sur `main`. Un merge/publication vers `main` exige l’accord explicite de François. Après une publication, revenir sur `recette` et la synchroniser.
2. **Aucune opération Git destructive** : pas de force push, `reset --hard`, `clean`, restauration globale ou rebase destructif.
3. **Aucun Firebase Production** depuis la recette. Une éventuelle recette Firebase doit cibler explicitement le projet Recette et Hosting uniquement.
4. **Données de généalogie** : pas d’opérations de test ou de migration qui écrivent dans la production.
5. Toute balise `<button>` a un `type` explicite et une cible tactile d’au moins 44 px. UI, tests et docs en français.
6. Les tests sont sensibles aux IDs, textes, tokens et markup exacts. Adapter les assertions avec les changements légitimes.
7. Ne pas modifier les modules historiques épinglés ni les fixtures pour faire passer les tests.

## Travail en cours : visionneuse de documents

### Diagnostic déjà mené

- La fiche Document unifiée utilise une URL source identique pour l’image affichée et le lien « Nouvel onglet » (`viewerImage.src` / `viewerExternalBtn.href`). Les chemins locaux, URLs externes, données Firestore et morceaux rejoignent le même affichage.
- L’ancien viewer de `main` contenait une logique de zoom antérieure qui affichait l’image contrainte au lecteur ; le viewer de recette ajoutait une transformation CSS `scale()` au zoom, ce qui pouvait agrandir une surface déjà rasterisée à sa petite taille de base.
- La logique locale d’optimisation au téléversement (notamment la dimension max de 2800 px) existait déjà dans la version locale de `main`. Les originaux réellement déployés et les documents de production n’ont pas été consultés ; cette comparaison concerne le code Git local.
- Conclusion à ce stade : le chemin d’affichage du viewer expliquait un défaut plausible et reproductible de netteté au zoom. Les tests synthétiques démontrent le mécanisme et le correctif, mais ne constituent pas une comparaison de qualité sur un document historique réel.

### Modifications locales actuelles

- `js/document-image-viewer.js` : nouveau contrôleur de zoom/panoramique, ratios et modes d’adaptation, resize, interactions tactiles. La boîte CSS de l’image suit son facteur d’affichage ; pas de `scale()` CSS pour simuler le zoom.
- `js/app.js` : branchement du contrôleur, navigation et retour vers le contexte d’origine après édition/consultation d’éléments liés ; lien nouvel onglet conservé vers la source de l’image.
- `index.html` : fiche Document, commandes du viewer et présentation unifiée ; le bouton Retour superflu a été supprimé au profit de la fermeture X.
- `tests/document-viewer-mobile.test.mjs` : mesures de géométrie desktop/mobile, modes, scroll portrait, pincement synthétique, boîte de rendu, source du lien, panneau repliable et fermeture X.
- `tests/genealogy-workspace-ui.test.mjs` : assertions structurelles ajustées.

Le dernier `git status` montre cinq fichiers suivis modifiés, dont le nouveau module :

```text
 M index.html
 M js/app.js
 M js/document-image-viewer.js
 M tests/document-viewer-mobile.test.mjs
 M tests/genealogy-workspace-ui.test.mjs
```

`css/design-system.css` n’apparaissait **pas** comme modifié dans le dernier `git status`, même si une synthèse précédente l’avait mentionné. Toujours se fier au diff réel du dépôt plutôt qu’à cette mention antérieure.

### Comportement mesuré avec contenu synthétique

Image portrait SVG 200×800, zone 360×280 px :

- Portrait long : mode initial ajusté à la largeur, image 360×1440 px, scroll vertical possible.
- « Ajuster à la fenêtre » : image entière 70×280 px.
- Retour au mode largeur : 360×1440 px.
- Lecteur réduit à 280 px : image 280×1120 px.
- Zoom tactile simulé : dimensions CSS augmentées en fonction du facteur de zoom, sans `scale()` CSS.
- Sur viewport desktop 1280×900, le panneau d’informations passe de 656 px à 1156 px lorsqu’il est replié puis revient à 656 px à la réouverture ; l’URL d’image reste inchangée.

Il s’agit de **géométrie de navigateur calculée sur SVG synthétique**, pas de mesure d’un original/photo réelle ou du détail des pixels d’un scan.

### Résultats récents

Après les dernières modifications vérifiées :

- `node --check js/app.js` et `node --check js/document-image-viewer.js` : OK.
- Tests ciblés Viewer/Documents et interfaces voisines : **92/92**.
- `node --test --test-concurrency=3 tests/*.test.mjs` : **816/816**.
- Firestore Emulator, suite dédiée : **73/73**, projet de test `family-tree-emulator-test`.
- `npm.cmd run test:responsive` : **513 assertions, 0 échec** sur les viewports indiqués par le script.
- `npm.cmd run build:recette` : **42/42 ressources** servies localement, incluant le nouveau module.
- Playwright Chromium/WebKit dans les tests du viewer : dernière suite viewer **15/15** après ajout du test de fermeture X (la suite ciblée plus large ensuite donnait 92/92).
- `git diff --check` : OK. Avertissements Git LF→CRLF uniquement ; pas d’erreur de whitespace.

Les tests de responsive et build exécutés sont locaux. L’émulateur Firestore est séparé de la production ; ne jamais remplacer cette cible par un projet Firebase réel.

## État Git de référence à la clôture

- `HEAD` et `origin/recette` : `804801982e5755b73ee3e84f9f816f9fb04d4ea1` (`fix(documents): optimize image fit and reading modes`).
- `origin/main` local : `0d849e0105109ed8913e66094cee38e542096e36`.
- Branche active : `recette`, synchronisée avec `origin/recette` au dernier contrôle.
- **Aucun commit, push, merge ou déploiement n’a été effectué pour les changements non commités ci-dessus.**
- `firestore.rules`, config Firebase et données distantes inchangées.

Six fichiers non suivis préexistants ont été repérés et doivent être préservés :

```text
DEMARCHES_RULES.md
LA_NOSTRA_STORIA_DESIGN_SYSTEM.md
RESPONSIVE_390_QA_REPORT.md
RESPONSIVE_QA_REPORT.md
RESPONSIVE_UX_QA_REPORT.md
tests/_repro-transfer-fingerprint.mjs
```

Ils ne doivent pas être inclus, supprimés ou remplacés par inadvertance lors d’un éventuel commit.

## Étapes possibles pour la suite

1. Reprendre et relire le diff complet sans écraser les changements présents. Vérifier l’accessibilité et le contexte de retour après consultation, édition et fermeture.
2. Rejouer les suites après toute retouche, au minimum les tests ciblés, la suite générale, l’émulateur, responsive et build local recette.
3. Comparer visuellement **le même fichier réel autorisé**, à une taille d’affichage comparable, avec le viewer corrigé et une référence appropriée. Ne pas récupérer ni écrire de document dans Firestore de production pour fabriquer un test.
4. Tester zoom/pan avec Safari iOS sur appareil réel si disponible. Les événements tactiles synthétiques Playwright ne remplacent pas ce contrôle.
5. Présenter le constat et demander la décision de François avant publication ou merge vers `main`. Aucun accord de publication n’est consigné dans cette session.

## Formulation de reprise à coller dans la nouvelle session

> Lis `AGENTS.md` et `PASSATION_SESSION_2026-10-25.md`, puis inspecte `git status` et le diff courant sur `recette`. Reprends le chantier local de la visionneuse de documents sans écraser les changements ni les fichiers non suivis. Confirme-moi d’abord l’état exact, puis poursuis les validations et le contrôle visuel réel si autorisé. Ne committe, ne pousse, ne déploie et n’accède pas à Firebase Production sans ma demande explicite.
