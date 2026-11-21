# Publication des règles Firestore nettoyées en recette — Lot 5C.2

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche | `recette` |
| HEAD contrôlé avant publication | `400f240` |
| Projet Firebase cible | `la-nostra-storia-recette` uniquement |
| Méthode | API Firebaserules, projet explicite |
| Production | Non ciblée, ruleset inchangé |

## 1. Périmètre

Publication exclusive du fichier local validé `firestore.rules`, après retrait des règles et validateurs Démarches au lot 5C.1. Aucun index, Hosting, Functions, code applicatif, permission IAM ou donnée Firestore n'a été déployé ou modifié.

## 2. Projet cible et identité

- Projet recette identifié par `js/firebase-environment.js`, `.firebaserc` et le ruleset actif lu : `la-nostra-storia-recette`.
- Le `.firebaserc` conserve Production comme `default`. Aucune sélection implicite n'a été utilisée : tous les appels Firebaserules incluaient explicitement le projet recette dans leur URL.
- Identité de la CLI Firebase vérifiée ; aucun jeton ou credential n'est consigné dans le journal.
- Permissions vérifiées sur le projet recette seulement : `firebaserules.rulesets.create`, `firebaserules.rulesets.get`, `firebaserules.releases.get`, `firebaserules.releases.update`.
- Variables de redirection/émulateur absentes avant publication (`GOOGLE_APPLICATION_CREDENTIALS`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIREBASE_CONFIG`, `FIRESTORE_EMULATOR_HOST`, `FIREBASE_DATABASE_EMULATOR_HOST`).
- `firebase.json` référence `firestore.rules`. La publication a utilisé l'API Firebaserules et n'a pas invoqué `firebase deploy`.

## 3. Candidat local

- HEAD vérifié : `400f240` (`security: remove obsolete procedures Firestore rules`).
- SHA-256 de `firestore.rules` avant publication :
  `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd`.
- Vérifications préalables : `validProcedure`, `validProcedureAction`, le bloc `match /procedures` et le sous-bloc `actions` absents ; `isApproved`, `validUpdatedBy` et le catch-all deny présents.
- Aucun octet du candidat n'a été modifié pendant la publication.

## 4. Ruleset précédent et sauvegarde privée

Lecture Firebaserules avant publication :

| Métadonnée | Valeur |
|---|---|
| Release | `projects/la-nostra-storia-recette/releases/cloud.firestore` |
| Ruleset précédent | `projects/la-nostra-storia-recette/rulesets/21b0044f-cc2b-4579-8a39-184ed32334eb` |
| SHA-256 du contenu actif précédent | `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` |
| `updateTime` de la release précédente | `2026-11-13T10:58:04.387642Z` |

L'identifiant et le hash correspondaient à la référence historique de `DEMARCHES_RULES.md`. Avant publication, la release et le ruleset précédent ont été copiés hors dépôt, sous ACL restreintes :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5c2-firestore-rules-recette\`

Fichiers : `previous-release.json`, `previous-ruleset.json`, `PREDEPLOY-MANIFEST.json`. Cette copie est une sauvegarde privée, non publiée et non versionnée.

## 5. Résultats des tests avant publication

| Vérification | Résultat |
|---|---:|
| `npm run test:firestore -- --project family-tree-emulator-test` | **78/78 réussis**, 0 échec, 0 ignoré |
| Refus Démarches (anonyme, pending, admin, membre) | **4/4 scénarios réussis** |
| `node --test tests/final-qa.test.mjs tests/interaction-language.test.mjs` | **2/2 réussis** |
| Invariants Firestore statiques | Réussis |
| Syntaxe des modules de tests modifiés | `node --check` réussi |
| Chargement/validation Firestore Rules | Réussi par l'émulateur |

La suite retenue a utilisé le projet fictif explicite `family-tree-emulator-test`, l'hôte `127.0.0.1:8080`, ainsi que l'émulateur Auth local. Une invocation initiale sans `--project` avait produit un avertissement de projet multiple dû au `default` du `.firebaserc` ; elle est restée sur l'émulateur local. La relance explicite ci-dessus est le résultat retenu et ne produit pas cet avertissement. Aucun endpoint Firestore recette ou Production n'a été appelé par les tests.

## 6. Publication effectuée

API Firebaserules utilisée, avec ID de projet fixé explicitement :

1. `POST /v1/projects/la-nostra-storia-recette/rulesets` — création d'un ruleset contenant le seul fichier `firestore.rules` local ;
2. vérification par GET du ruleset nouvellement créé et comparaison au candidat local ;
3. relecture immédiate de la release pour confirmer que le ruleset précédent n'avait pas changé ;
4. `PATCH /v1/projects/la-nostra-storia-recette/releases/cloud.firestore?updateMask=rulesetName` — activation du nouveau ruleset.

Résultat : PATCH réussi ; la release active a été relue après publication.

| Métadonnée | Valeur |
|---|---|
| Projet | `la-nostra-storia-recette` |
| Ruleset actif précédent | `21b0044f-cc2b-4579-8a39-184ed32334eb` |
| Nouveau ruleset actif | `84fd9275-347d-4348-90b3-e1caf9bc5f20` |
| Publication vérifiée à (UTC) | `2026-11-21T11:41:46.804Z` |
| `updateTime` de la release après publication | `2026-11-21T11:41:44.802901Z` |
| SHA-256 brut du contenu actif relu | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` |

## 7. Vérification du contenu actif après publication

Le contenu du ruleset actif a été relu via l'API Firebaserules et comparé au candidat local :

- contenu actif = `firestore.rules` local (égalité exacte du texte retourné, sans différence de fins de ligne) ;
- SHA-256 brut actif = SHA-256 candidat : `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` ;
- `validProcedure`, `validProcedureAction`, `match /procedures` et `match /actions/{actionId}` absents ;
- `isApproved`, `validUpdatedBy` présents ;
- catch-all `match /{document=**}` avec `allow read, write: if false` présent ;
- contenu actif identique au candidat ; aucun écart dans les autres règles.

Les refus pour `procedures` et `actions` sont établis par le ruleset relu (aucun match autorisant ces chemins, catch-all deny) et les tests client de l'émulateur local. Aucune écriture de test n'a été faite sur le projet réel.

## 8. Production et autres ressources

- Aucun appel Firebaserules n'a ciblé `family-tree-c2fe2`.
- Aucun déploiement Production, Hosting, Functions ou index n'a été effectué.
- Aucune donnée Firestore, recette ou production, n'a été lue ou modifiée par la publication ; seuls les endpoints Firebaserules recette ont été utilisés.
- Le ruleset Production documenté reste `cc8f5732-749e-41fc-a359-95536d663add`, avec l'ancien SHA `8237de11…` ; il conserve donc ses règles Démarches jusqu'à une autorisation et un lot distincts.
- `firestore.rules` local est désormais identique au ruleset actif recette, mais diverge intentionnellement du ruleset Production.

## 9. Journal et anomalies

Journal technique privé hors dépôt :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5c2-firestore-rules-recette\publication-journal.txt`

Le résultat structuré est conservé dans `publication-result.json`. La copie précédente du ruleset reste dans le même dossier. Aucun secret ni credential n'est inclus.

**Anomalies de publication : aucune.** L'avertissement de projet multiple de la première invocation de tests a été levé en relançant ceux-ci avec le projet émulateur explicitement indiqué avant publication.

Le document de référence `DEMARCHES_RULES.md` conserve encore son état documentaire pré-5C.2 (candidat local non publié). Il n'a pas été inclus dans les fichiers de ce lot, conformément à la consigne de ne versionner que le rapport ; le présent rapport fait foi pour l'état post-publication recette. Sa mise en cohérence documentaire reste à planifier séparément.

## 10. Procédures suivantes

- Aucun déploiement Production n'est autorisé par le présent lot. Un éventuel 5C.3 nécessite une instruction distincte et les vérifications propres à Production.
- Le nettoyage des règles en Production, les lots 6 et 7 et toute autre modification de règles restent non démarrés.

---

*Lot 5C.2 terminé en recette. Aucune publication Production, aucun déploiement Hosting, aucune modification de données Firestore.*
