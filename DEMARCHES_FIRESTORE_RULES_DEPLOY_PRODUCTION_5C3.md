# Publication des règles Firestore nettoyées en Production — Lot 5C.3

| Élément | Valeur |
|---|---|
| Date | 2026-11-21 |
| Branche de travail | `recette` |
| HEAD vérifié avant lot | `8d5ce92` |
| Projet ciblé | `family-tree-c2fe2` |
| Base Firestore | `(default)`, Firestore Native, région `eur3` |
| Publication | API Firebaserules, projet explicite uniquement |

## 1. Périmètre et autorisation

Publication du seul candidat `firestore.rules` validé sur Production. Aucune donnée Firestore, configuration, permission IAM, index, fonction, ressource Hosting ou version d'asset n'a été modifiée.

## 2. Identification et autorisation Production

- Les trois références de l'identifiant concordaient : `js/firebase-environment.js`, `DEMARCHES_FIRESTORE_AUDIT_5A.md` et le manifeste Production 5B.1 indiquent `family-tree-c2fe2`.
- L'identité de la CLI Firebase a été vérifiée ; le compte propriétaire est authentifié.
- Les permissions `firebaserules.rulesets.create`, `firebaserules.rulesets.get`, `firebaserules.releases.get` et `firebaserules.releases.update` ont été vérifiées sur Production uniquement. Aucune permission IAM n'a été modifiée.
- La base `projects/family-tree-c2fe2/databases/(default)` a été relue en metadata : type `FIRESTORE_NATIVE`.
- Le `.firebaserc` désigne Production comme `default`, mais aucune sélection implicite n'a été utilisée : les URL Firebaserules et metadata portaient explicitement `family-tree-c2fe2`.
- Les variables d'environnement de credentials, de redirection et d'émulateur étaient absentes. L'API Firebaserules était utilisée directement ; aucun `firebase deploy`.

## 3. SHA-256 et candidat

SHA-256 local de `firestore.rules`, recalculé avant publication :

`f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd`

Il correspond au hash validé en 5C.1 et au ruleset actif recette 5C.2. Le fichier candidat n'a pas été modifié pendant ce lot.

Contrôles sur le candidat : `validProcedure`, `validProcedureAction`, `match /procedures` et tout sous-bloc `actions` absents ; `isApproved`, `validUpdatedBy` et le catch-all deny présents.

## 4. Ruleset Production précédent et sauvegarde privée

Lecture préalable de la release Production :

| Métadonnée | Valeur |
|---|---|
| Release Firestore | `projects/family-tree-c2fe2/releases/cloud.firestore` |
| Ruleset actif précédent | `projects/family-tree-c2fe2/rulesets/cc8f5732-749e-41fc-a359-95536d663add` |
| SHA-256 contenu précédent | `8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` |
| `updateTime` précédent | `2026-11-13T10:50:02.893250Z` |

Le ruleset actif correspondait au SHA et à l'identifiant attendus dans l'audit 5A / `DEMARCHES_RULES.md`. Son contenu normalisé en fins de ligne correspondait aussi au baseline Git `668d8e5`.

Avant publication, une copie privée du ruleset précédent, de la release et de leur manifeste a été conservée sous ACL restreintes, hors dépôt :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5c3-firestore-rules-production\`

La comparaison `668d8e5` → candidat (`firestore.rules`) a donné **0 ajout, 62 suppressions**. L'inspection des hunks confirme que ces suppressions sont uniquement `validProcedure`, `validProcedureAction` et le bloc `procedures/actions`. Aucun autre changement de permission ou de règle n'était présent.

## 5. Tests préalables

| Vérification | Résultat |
|---|---:|
| `npm run test:firestore -- --project family-tree-emulator-test` | **78/78 réussis**, 0 échec, 0 ignoré |
| Scénarios de refus Démarches (anonyme, pending, admin principal, membre approuvé) | **4/4 réussis** |
| `node --test tests/final-qa.test.mjs tests/interaction-language.test.mjs` | **2/2 réussis** |
| Invariants Firestore statiques | Réussis |
| Syntaxe des tests modifiés | Réussie |
| Compilation des règles par l'émulateur | Réussie |

L'émulateur était local (`127.0.0.1:8080`, Auth local) et utilisait l'ID fictif `family-tree-emulator-test`. La garde anti-production du test l'a confirmé. Aucun test n'a appelé un projet Firebase réel.

## 6. Publication effectuée

Publication exclusivement via l'API Firebaserules avec `family-tree-c2fe2` explicitement dans chaque ressource :

1. `POST /v1/projects/family-tree-c2fe2/rulesets` avec le contenu du candidat local `firestore.rules` uniquement ;
2. GET du ruleset créé et comparaison du contenu avant activation ;
3. relecture immédiate de la release Production pour contrôler le ruleset précédent et son `updateTime` ;
4. `PATCH /v1/projects/family-tree-c2fe2/releases/cloud.firestore?updateMask=rulesetName` pour associer le nouveau ruleset.

L'API Release n'exposait pas d'`etag` utilisable comme précondition atomique. La release a donc été relue immédiatement avant PATCH ; son ruleset et son `updateTime` étaient inchangés. Aucun ruleset ou release recette n'a été modifié par ces appels.

| Résultat | Valeur |
|---|---|
| Projet | `family-tree-c2fe2` |
| Ruleset précédent | `cc8f5732-749e-41fc-a359-95536d663add` |
| Nouveau ruleset actif | `50f2d73b-4d6d-4750-9bd1-212f373e1f89` |
| Release active | `projects/family-tree-c2fe2/releases/cloud.firestore` |
| `updateTime` après publication | `2026-11-21T12:05:36.661478Z` |
| SHA-256 brut du contenu actif | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` |
| Publication vérifiée à (UTC) | `2026-11-21T12:05:38.368Z` |

## 7. Vérification après publication

Le ruleset Production a été relu via Firebaserules après activation :

- le ruleset actif est `50f2d73b-4d6d-4750-9bd1-212f373e1f89` ;
- son contenu correspond au candidat local (égalité du texte après normalisation des fins de ligne) et son SHA brut est exactement le SHA candidat ;
- `validProcedure`, `validProcedureAction`, `match /procedures` et `match /actions/{actionId}` sont absents ;
- `isApproved`, `validUpdatedBy`, le catch-all et `allow read, write: if false` sont présents ;
- tous les autres blocs sont égaux au candidat audité, donc aucune différence inattendue n'est introduite.

Une relecture Firebaserules post-publication des deux environnements confirme aussi :

| Environnement | Ruleset actif | SHA-256 actif | Correspond au candidat |
|---|---|---|---|
| Recette `la-nostra-storia-recette` | `84fd9275-347d-4348-90b3-e1caf9bc5f20` | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` | Oui, inchangé |
| Production `family-tree-c2fe2` | `50f2d73b-4d6d-4750-9bd1-212f373e1f89` | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` | Oui |

Le refus d'accès aux anciens chemins est confirmé par le ruleset actif (aucun match dédié, catch-all deny) et par les tests client de l'émulateur. Aucune écriture de test sur une base réelle n'a été effectuée.

## 8. Données et autres services Firebase

- Aucune requête aux endpoints de documents Firestore et aucune écriture ou suppression de données n'a été effectuée.
- La recette n'a pas été modifiée pendant la publication Production ; son release actif et son SHA sont restés ceux de 5C.2.
- Aucun changement Hosting, Functions, index, IAM, dépendance ou configuration Firebase ; aucune commande `firebase deploy`.
- Les sauvegardes privées 5B.1 et la copie privée du ruleset Production précédent sont conservées hors dépôt.
- Le code applicatif, les assets et `main` n'ont pas été modifiés.

## 9. Journal et anomalies

Journal privé hors dépôt :

`C:\Users\<compte-utilisateur>\Documents\family-tree-technical-archive\lot-5c3-firestore-rules-production\publication-journal.txt`

Résultat structuré : `publication-result.json`. Copie précédente : `previous-release.json`, `previous-ruleset.json`, `PREDEPLOY-MANIFEST.json`. L'accès au dossier privé est restreint ; aucun jeton ou credential n'est enregistré.

**Anomalies de publication : aucune.**

## 10. État documentaire et suites

`DEMARCHES_RULES.md` est mis à jour dans ce lot avec les rulesets finaux actifs en recette et production, leurs SHA-256 et l'historique de publication 5C.1–5C.3. Les rulesets historiques restent consignés ; le ruleset antérieur de Production est sauvegardé hors dépôt.

Le lot 5C.3 clôt le nettoyage des règles Démarches. Aucun lot 6/7 ni autre changement de règles n'a commencé.

---

*Lot 5C.3 terminé. Règles Démarches publiées et vérifiées en Production ; aucune autre ressource Firebase n'a été modifiée.*
