# Rapport technique — lot 6 : collaboration et sécurité

## Périmètre livré

- Modèle métier pur dans `js/genealogy-collaboration.js` : propositions, transitions, événements et notifications.
- API transactionnelle dans `js/genealogy-collaboration-firestore.js`, conçue pour recevoir le SDK Firestore déjà chargé par l'application.
- Règles additives dans `firestore.rules`. Les collections et champs historiques n'ont pas été renommés ni migrés.
- Tests unitaires et intégration Firebase Emulator.

## Collections nouvelles

| Collection | Usage | Accès |
|---|---|---|
| `genealogyProposals` | Brouillons et propositions en attente/acceptées/refusées/annulées | L'auteur approuvé lit les siennes ; les administrateurs les lisent et prennent les décisions |
| `genealogyEvents` | Journal append-only des transitions et opérations | Lecture par utilisateurs approuvés ; création contrôlée et auteur authentifié |
| `genealogyNotifications` | Notifications personnelles non lues/lues | Lecture et acquittement uniquement par le destinataire ; création administrative contrôlée |
| `sourceDocuments`, `sourceRevisions` | Source officielle courante et snapshots de versions | Lecture approuvée ; écriture admin ; versions immuables |
| `transcriptionHeads`, `transcriptionRevisions` | Tête courante et versions de transcription | Lecture approuvée ; écriture admin ; versions immuables |
| `genealogyProofs`, `genealogyProofRevisions` | Preuves officielles et versions | Lecture approuvée ; écriture admin ; versions immuables |
| `factConclusions`, `conclusionRevisions` | Conclusion courante et versions | Lecture approuvée ; écriture admin ; versions immuables |

Chaque modification officielle écrit, dans une transaction, la nouvelle tête, son snapshot immuable et l'événement append-only. Les règles recoupent l'auteur, les identifiants de version, les données du snapshot et la version précédente. Les décisions de conclusion restent distinctes des faits de l'arbre.

## Cycle des propositions et sécurité

- Création en `draft`, modification/annulation réservée à l'auteur, soumission en `pending`, décision admin vers `accepted` ou `rejected`.
- Les transitions utilisent `runTransaction`; chaque transition de proposition écrit aussi son événement. La décision et la notification à l'auteur sont atomiques.
- Un membre approuvé ne peut ni écrire les collections officielles, ni accepter/refuser, ni modifier la proposition d'un autre auteur.
- Les événements et snapshots historiques ne peuvent être modifiés ou supprimés.
- `createdAt`, `updatedAt`, `submittedAt`, `resolvedAt` et `readAt` sont vérifiés contre `request.time` dans les Rules ; `actorUid`/`authorUid` sont rapprochés de l'identité authentifiée.
- Les notifications à l'auteur d'une proposition sont liées à la proposition décidée et à son événement. Les notifications de réexamen sont liées à un événement correspondant et ne peuvent cibler qu'un admin approuvé.

## Limite des notifications sans serveur

Un contributeur ne peut pas créer une notification adressée aux administrateurs. La soumission produit atomiquement un événement `proposal.submitted`, utilisable comme signal fiable par la file de propositions en attente. `notifyAdministrators` permet à un administrateur de créer les notifications de cette file ; `createReexaminationEvent` écrit atomiquement l'événement et les notifications administrateur.

Une émission automatique garantie au moment exact de la soumission par un contributeur nécessiterait un déclencheur serveur. Aucun service n'a été ajouté ni déployé ; l'événement, le schéma et le chemin de notification sécurisé sont préparés localement.

## Limites fonctionnelles et de sécurité restantes

- Firestore Rules imposent les contrôles aux clients Firebase, mais ne constituent pas une barrière contre un accès privilégié utilisant Admin SDK ou IAM.
- Les collections historiques (`documents`, `people`, etc.) gardent leurs autorisations antérieures ; en particulier, `documents` reste modifiable par tout compte approuvé selon la règle existante. Le nouveau verrouillage administrateur s'applique aux nouvelles collections officielles listées ci-dessus. Aucune migration ou requalification des anciens documents n'a été faite.
- L'interface de l'application n'est pas encore raccordée à cette API de collaboration ; les écrans et le flux utilisateur relèvent de l'intégration ultérieure.
- Les propositions acceptées ne créent pas automatiquement un objet officiel et ne modifient jamais l'arbre ; l'administrateur crée explicitement la donnée officielle dans une opération distincte.

## Tests et vérifications

- `node --test tests/genealogy-collaboration.test.mjs` : **4 réussis**.
- Vérifications statiques ciblées (`final-qa`, `interaction-language`, `responsive-accessibility`, `qa-70-cases`, modèles de preuves et conclusions) : **43 réussis**.
- Firebase Emulator local, projet `family-tree-emulator-test`, Firestore/Auth : **70 réussis, 0 échec**, y compris les tests préexistants. Le scénario lot 6 vérifie les refus de réécriture des propositions acceptée et rejetée, l'immutabilité des révisions et le refus de modifier une conclusion par un contributeur.
- `node --check` sur les modules et le fichier de test Emulator : réussi.
- `git diff --check` : réussi.
- Le lancement large `node --test`/glob n'a pas terminé dans l'environnement Windows Node 24 ; la suite Emulator complète et les tests statiques ciblés ont été exécutés séparément.

## État du dépôt et sécurité des données

- Branche `recette`, HEAD de départ `abb291df0d508680c41deccabc59266faf766636`.
- Aucun accès Firebase distant, push, déploiement, changement Blaze, Cloud Storage ou migration.
- Les fichiers non suivis présents avant le lot restent préservés.
- Les journaux Emulator ont été dirigés vers un dossier temporaire. L'empreinte SHA-256 de `firestore-debug.log` du dépôt est restée `58C909EB341431309EBAA0F0544060F0155F8E763917AD5F8502B1E1CD279C9A`.
