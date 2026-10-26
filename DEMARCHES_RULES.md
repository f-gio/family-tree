# Règles Firestore — nouvelle collection « procedures » (Démarches)

Le fichier `firestore.rules` du dépôt est **gelé** (pin `tests/fixtures/v18`, testé par
`final-qa.test.mjs`). Cette évolution est strictement **additive** : elle ajoute une
collection et une sous-collection, sans modifier aucune règle existante.

⚠️ **Ne pas modifier `firestore.rules` du dépôt.** À la place, publiez manuellement
via **Firebase Console → Firestore → Règles**, en ajoutant les deux blocs ci-dessous
**avant** la règle finale `match /{document=**} { allow read, write: if false; }`.
Aucun `firebase deploy` : la publication se fait en copiant le texte dans la Console.

```text
    // Dossiers de démarche : recherches, correspondances, rendez-vous et formalités.
    match /procedures/{dossierId} {
      allow read, create, update, delete: if isApproved();
      match /actions/{actionId} {
        allow read, create, update, delete: if isApproved();
      }
    }
```

Le reste des règles est inchangé. Sans cette publication, la vue « Démarches »
affiche l’état « Accès refusé — publiez les nouvelles règles Firebase » (comportement
voulu et testé). Les collections existantes (people, families, documents, tasks,
users, documentChunks, publicConfig, settings/access) ne sont pas touchées.
