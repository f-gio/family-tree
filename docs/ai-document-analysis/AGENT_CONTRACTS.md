# Contrats des rôles et données d’exécution

Les schémas ci-dessous sont conceptuels et illustratifs (JSON compatible, pas un JSON Schema normatif). Ils ne décrivent ni collections Firestore ni changements au modèle actuel. Les identifiants et horodatages sont attribués par l’orchestrateur. Les sorties sont validées avant conservation ; champ absent et champ connu nul ne doivent pas être confondus.

## 1. Contexte commun et contrat d’appel

Une tâche reçoit seulement les données nécessaires : `runId`, `taskId`, rôle, version de contrat, cible (document/page/zone/segment), références/empreintes des entrées, contexte autorisé et borné, consigne/configuration versionnée, moteur demandé (ou `local-rule`). Les octets de l’original sont lus en lecture seule. Chaque appel rend soit une sortie conforme, soit une erreur structurée ; un texte libre seul n’est jamais considéré comme une sortie validée.

Enveloppe commune de résultat :

```json
{
  "resultId": "res-001",
  "runId": "run-001",
  "taskId": "task-ocr-p1",
  "role": "paleographer",
  "target": { "documentId": "doc-17", "pageId": "page-1" },
  "inputRefs": [{ "kind": "original", "sha256": "…", "page": 1 }],
  "producer": {
    "engine": "candidate-name-or-local",
    "model": "model-id-or-null",
    "modelVersion": "version-or-null",
    "promptId": "paleographer-it-v1",
    "configHash": "sha256-of-config"
  },
  "createdAt": "2026-01-01T12:00:00Z",
  "confidence": "medium",
  "status": "proposed",
  "output": {},
  "provenance": [{ "kind": "image-region", "page": 1, "regionId": "r-1" }]
}
```

`confidence` est exactement `high|medium|low|unknown`, interprétation locale et qualitative par rôle (`high` signifie confiance élevée). Elle ne signifie pas 90/60/10 % et ne doit pas être agrégée comme une probabilité. Les marqueurs d’incertitude et `requiresHuman` sont des informations distinctes. `status` de résultat : `proposed`, `needs_review`, `accepted`, `rejected`, `superseded`. Seul un humain peut attribuer `accepted`/`rejected` à une proposition ; le système peut établir `superseded` lorsqu’une nouvelle version la remplace, en conservant l’historique.

## 2. Objets communs

### Document et page d’entrée

```json
{
  "documentId": "doc-17",
  "original": { "uri": "local://archives/registro-1902.jpg", "sha256": "…", "mimeType": "image/jpeg", "sizeBytes": 840000 },
  "metadata": { "title": "Registro …", "category": "civil-register", "place": "…", "dateInfo": { "type": "year", "year": 1902 }, "languageHints": ["it"] },
  "page": { "pageId": "page-1", "ordinal": 1, "imageSha256": "…", "width": 2400, "height": 3600, "rotation": 0 }
}
```

URI n’implique aucun accès réseau : dans le prototype, résoudre uniquement des chemins autorisés locaux. Métadonnées inconnues restent inconnues ; ne pas inférer une date exacte à partir d’une année.

### Zone ou ligne

```json
{
  "regionId": "r-1", "pageId": "page-1", "kind": "column",
  "polygon": [[0.08, 0.12], [0.48, 0.12], [0.48, 0.91], [0.08, 0.91]],
  "order": 1, "readingDirection": "top-to-bottom", "label": "colonna sinistra"
}
```

Coordonnées normalisées 0..1 par rapport à l’image originale, origine en haut à gauche. Le polygone peut être absent si un moteur ne sait pas l’estimer ; ne pas fabriquer un alignement. Lignes ont un identifiant stable dans une version, un ordre, et si possible leur propre boîte/polygone.

## 3. Contrats de rôle

| Rôle | Entrée minimale | Sortie attendue / garde-fou |
|---|---|---|
| Archiviste | image/page et métadonnées disponibles | classification(s), langues, structure, zones, éléments de contexte avec sources ; période/type incertains sont déclarés, non inventés |
| Paléographe | image originale, zones validées, consigne paléographique | lignes diplomatiques ordonnées, texte exact, graphies, segments illisibles/lacunes/alternatives, ancrages et incertitudes ; pas de normalisation silencieuse |
| Vérificateur | original + version d’une transcription identifiée ; éventuellement lecture indépendante réellement distincte | désaccords localisés, erreurs probables, passages à vérifier et justification visuelle ; n’écrase jamais le texte, ne transforme pas la lecture partagée en corroboration indépendante |
| Traducteur | transcription source et IDs de segments/versions | traduction française segment par segment, incertitudes conservées, notes historiques distinguées du texte traduit ; aucune correction de l’italien |
| Extracteur | texte source exact, traduction facultative et références de segments | assertions typées, valeurs source, interprétation séparée, citations et provenances ; aucun fait non ancré |
| Analyste généalogique | assertions acceptées par l’utilisateur + contexte explicitement autorisé et minimisé | rapprochements/hypothèses avec éléments pour/contre, contradictions et manque d’information ; aucune écriture dans personnes/familles |

### Classification

```json
{
  "documentKind": { "value": "birth-register-entry", "confidence": "medium", "alternatives": ["baptism-register-entry"] },
  "languages": [{ "value": "it", "regionId": "r-1" }, { "value": "la", "regionId": "r-2" }],
  "structure": [{ "regionId": "r-1", "kind": "table-column", "order": 1 }],
  "contextNotes": [{ "text": "lecture de l'en-tête incertaine", "basis": "visible-heading", "confidence": "low" }]
}
```

### Transcription, alternative et traduction alignée

La convention textuelle est définie dans [TRANSCRIPTION_STANDARD.md](TRANSCRIPTION_STANDARD.md). L’exemple de sortie garde les clés conceptuelles `textIt`, `translationFr`, `hypotheses`, `anchor`, `lineLabel`, `translationState` compatibles avec les concepts déjà présents dans `document-transcription.js`, mais ne prétend pas être le payload Firestore de l’application.

```json
{
  "transcriptVersionId": "tr-4",
  "lines": [{
    "lineId": "l-01", "regionId": "r-1", "order": 1,
    "textIt": "… [lettura incerta] …", "lineLabel": "1",
    "unreadable": false,
    "hypotheses": [{ "id": "h-1", "text": "Bianchi", "confidence": "medium", "note": "lettura alternativa della consonante" }],
    "anchor": { "shape": "rect", "x": 0.1, "y": 0.12, "width": 0.32, "height": 0.035 },
    "confidence": "medium"
  }],
  "translationVersionId": "fr-2",
  "translations": [{ "lineId": "l-01", "textFr": "…", "translationState": "needs-review", "confidence": "medium" }]
}
```

Dans l’application actuelle, les passages sont adressés par document/page/passage/révision ; les ancres JPEG pointent une photographie précise et les ancres PDF une page PDF avec empreinte (cf. `document-transcription.js`). L’exemple ci-dessus raccourcit seulement la représentation.

### Assertion extraite et hypothèse généalogique

```json
{
  "assertionId": "a-1", "kind": "person-name", "valueSource": "Giovanni Bianchi",
  "normalizedSuggestion": "Giovanni Bianchi", "normalizationStatus": "suggestion-only",
  "evidence": [{ "documentId": "doc-17", "pageId": "page-1", "regionId": "r-1", "lineId": "l-01", "transcriptVersionId": "tr-4", "quote": "Giovanni Bianchi" }],
  "confidence": "medium", "status": "proposed"
}
```

`kind` peut être `person-name`, `name-variant`, `date`, `place`, `occupation`, `event`, `relationship`, `administrative-reference` ou autre type versionné. `valueSource` conserve la forme lue ; toute normalisation est une suggestion distincte. Une hypothèse F cite les IDs d’assertions, le contexte fourni, les éléments contradictoires et un statut `hypothesis`, sans devenir une assertion attestée.

## 4. Vérification, correction et validation

```json
{
  "verificationId": "ver-1", "targetResultId": "res-001", "reviewerRole": "verifier",
  "checks": [{ "lineId": "l-01", "finding": "possible-character-error", "alternatives": ["Bianchi", "Rianchi"], "reason": "trait initial peu visible", "confidence": "medium", "requiresHuman": true }],
  "independence": { "independentReading": false, "basis": "reviewed-existing-transcription" }
}
```

Une correction humaine est un événement append-only : `correctionId`, cible/version précédente, nouvelle valeur ou choix, champs concernés, auteur humain, date, motif facultatif, ancre, et relation aux résultats IA. Elle ne modifie pas le journal des anciennes sorties. Une validation distincte porte décision (`accept`, `reject`, `defer`, `accept-with-edits`), auteur, horodatage, portée exacte (ligne/passage/assertion) et version validée. Il n’existe pas de bouton logique « accepter tout le document » implicite.

## 5. Exécution et provenance

Chaque exécution garde `runId`, version du pipeline, cible(s), `createdAt`, `updatedAt`, état, tâches/dépendances, paramètres non secrets, empreintes des entrées, coûts comptabilisés, erreurs et événements. Chaque tentative garde moteur/modèle/version si connus, prompt/configuration et empreinte de ces configurations, heure, sortie brute (si autorisée), sortie normalisée, état et durée. Les secrets/jetons ne sont jamais enregistrés dans les journaux.

Erreur structurée conceptuelle : `{ "code": "input-unreadable", "message": "…", "retryable": false, "taskId": "…", "at": "…" }`. Les reprises créent une tentative nouvelle et gardent la précédente.

## 6. Contrôle de qualité des données

- Rejeter les sorties malformées, les identifiants de segments inconnus, les ancres hors bornes et toute assertion sans provenance.
- Conserver distinction entre `unknown`, chaîne vide, illisible et lacune matérielle.
- Ne pas normaliser Unicode, ponctuation ou espaces dans le texte diplomatique conservé ; une vue de comparaison normalisée pour les mesures est dérivée, jamais substituée à l’original.
- Distinguer la source textuelle, la traduction, l’interprétation et le contexte injecté.
- En cas de réponse tronquée ou d’erreur réseau, ne valider aucune sortie partielle sans statut explicite.

## Références de code examinées

`document-file-storage.js` (chunks, sans DOM), `source-document-model.js` (documents/pages/photos, références et SHA-256), `document-transcription.js` (passages, hypothèses, ancres, révisions figées, comparaison), `transcription-workshop.js` (brouillon pur), `transcription-draft-storage.js` / `transcription-draft-sync.js` (brouillons local/distants), `genealogy-proofs.js` (citations de révision/passage et relations de preuve). Ce sont des points d’alignement conceptuel, pas une demande de changement de schéma.
