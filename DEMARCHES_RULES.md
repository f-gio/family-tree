# Règles Firestore — référence locale et publication

`firestore.rules` est la référence versionnée **locale** pour préparer et tester
les règles. Depuis le lot 5C.1, le fichier local est un **candidat non publié** :
il retire les règles Démarches et n'est donc plus identique aux rulesets actifs.
Ne pas le considérer comme le contenu distant courant ni le publier sans une
autorisation dédiée et les contrôles de la section Publication.

Les rulesets réellement actifs conservent le SHA-256
`8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648` (UTF-8,
CRLF) :

| Environnement | Ruleset actif |
|---|---|
| Production `family-tree-c2fe2` | `cc8f5732-749e-41fc-a359-95536d663add` |
| Recette `la-nostra-storia-recette` | `21b0044f-cc2b-4579-8a39-184ed32334eb` |

Les règles actives comprennent notamment les **sept types de dates** (`exact`,
`year`, `about`, `before`, `after`, `between`, `unknown`), la validation des
transcriptions officielles (`hasNonEmptyItalian` : texte italien vide **ou**
uniquement composé de blancs refusé), les permissions, les règles Démarches
historiques (`procedures`) et le `catch-all`.

Le candidat local issu du lot 5C.1 conserve ces invariants et retire uniquement
`validProcedure`, `validProcedureAction` et le bloc `match /procedures`. Son
SHA-256 est `f1d31e923dbe73426839ebf8b8ad272cbb26093ac9f0c41761c879e6cf3553dd`.
Il n'a été publié ni en recette ni en production.

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
- Avant publication : relever le SHA-256 local du candidat et le comparer à
  celui de la release active (API Firebaserules). Après le lot 5C.1, les hashes
  **diffèrent intentionnellement** : toute publication exige l'autorisation
  dédiée, les tests obligatoires et une revue ciblée du diff. **Ne jamais
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
