# Règles Firestore — référence locale et publication

`firestore.rules` est la référence versionnée locale des règles. Depuis la
clôture du lot 5C, le contenu local est identique aux règles actives dans les
deux environnements :

| Environnement | Ruleset actif | SHA-256 du contenu actif (UTF-8) |
|---|---|---|
| Recette `la-nostra-storia-recette` | `84fd9275-347d-4348-90b3-e1caf9bc5f20` | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` |
| Production `family-tree-c2fe2` | `50f2d73b-4d6d-4750-9bd1-212f373e1f89` | `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd` |

Les règles actives comprennent notamment les **sept types de dates** (`exact`,
`year`, `about`, `before`, `after`, `between`, `unknown`), la validation des
transcriptions officielles (`hasNonEmptyItalian` : texte italien vide **ou**
uniquement composé de blancs refusé), les permissions partagées et le
`catch-all`. Les règles Démarches (`procedures` et sous-collection `actions`)
ont été retirées et publiées dans les deux environnements.

Les rulesets précédents, avant retrait des règles Démarches, étaient Production
`cc8f5732-749e-41fc-a359-95536d663add` et recette
`21b0044f-cc2b-4579-8a39-184ed32334eb`, au SHA-256
`8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`.
Le ruleset précédent de Production a été conservé dans une archive technique
privée hors dépôt.

Les anciens fichiers secondaires — `firestore.rules.recette`,
`firestore.rules.production-candidate`, `firestore.rules.candidate` — ont été
**supprimés le 2026-11-13** : toute copie alternative créait un risque de
publication d'une ancienne version. Ne pas les recréer.

## Publication

- **Aucun `firebase deploy`** : la publication se fait en copiant le contenu
  exact de `firestore.rules` dans **Firebase Console → Firestore → Règles**,
  ou via l'API Firebaserules (`POST /v1/projects/{p}/rulesets` puis
  `PATCH /v1/projects/{p}/releases/cloud.firestore` avec le corps enveloppé
  sous `release`).
- Avant toute nouvelle publication : relever le SHA-256 local et le comparer
  à celui de la release active de l'environnement explicitement ciblé (API
  Firebaserules). Toute publication exige une autorisation dédiée, les tests
  obligatoires et une revue ciblée du diff. **Ne jamais
  publier une version historique de git** (ni l'ancien fichier à cinq types de
  dates conservé dans `tests/fixtures/v18/firestore.rules`).
- Après publication : consigner le nouvel identifiant de ruleset.
- `npm run test:firestore` est **obligatoire** dès que `firestore.rules`
  change (voir `AGENTS.md`, niveaux de vérification).

## Historique

Le fichier était autrefois gelé (pin `tests/fixtures/v18`, validation des dates à
cinq types) et les blocs « Démarches » devaient être ajoutés manuellement à la
console. Ce gel a été levé le 2026-11-13, lorsque `firestore.rules` a reçu le
contenu exact publié en production puis en recette (sept types de dates +
`hasNonEmptyItalian` renforcé). Les snapshots `tests/fixtures/v16/v17/v18`
restent historiques et ne doivent pas être modifiés.

Au lot 5C.1, les données Démarches ayant été supprimées et vérifiées dans les
deux environnements, les règles dédiées ont été retirées **du candidat local
uniquement**. Les releases actives et leurs identifiants n'ont pas été modifiés.

Au lot 5C.2, le candidat a été publié en recette sous le ruleset
`84fd9275-347d-4348-90b3-e1caf9bc5f20`. Au lot 5C.3, le même contenu a été
publié en Production sous le ruleset `50f2d73b-4d6d-4750-9bd1-212f373e1f89`.
Les deux contenus actifs ont ensuite été relus et comparés au candidat.
