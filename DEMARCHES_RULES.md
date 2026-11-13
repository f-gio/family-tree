# Règles Firestore — référence unique et publication

`firestore.rules` est la **référence unique** des règles Firestore du projet. Son
contenu est strictement identique (SHA-256
`8237de11f84e034d425becb74072c52ec353b7841d257aa50fbc76ce59b98648`, UTF-8, CRLF)
aux règles réellement actives :

| Environnement | Ruleset actif |
|---|---|
| Production `family-tree-c2fe2` | `cc8f5732-749e-41fc-a359-95536d663add` |
| Recette `la-nostra-storia-recette` | `21b0044f-cc2b-4579-8a39-184ed32334eb` |

Ce contenu comprend notamment les **sept types de dates** (`exact`, `year`,
`about`, `before`, `after`, `between`, `unknown`), la validation des
transcriptions officielles (`hasNonEmptyItalian` : texte italien vide **ou**
uniquement composé de blancs refusé), les permissions, les règles Démarches
(`procedures`) et le `catch-all`.

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
- Avant publication : relever le SHA-256 local de `firestore.rules` et le
  comparer à celui de la release active (API Firebaserules). **Ne jamais
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
