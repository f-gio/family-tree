# Recherches — lot R1 : cibles de justification

## Périmètre livré

`js/justification-targets.js` est un registre pur : l'appelant lui fournit des snapshots `people` et `families`, il retourne `{ schemaVersion, targets, excluded }`. Il n'a aucune dépendance Firebase/DOM/réseau, ne lit ni n'écrit de données, ne modifie pas ses entrées et ne crée aucune Preuve, Attestation, Conclusion ou valeur généalogique. R1 n'ajoute pas d'écran.

Une cible est un emplacement structuré, avec `id`, `targetType`, libellé, propriétaire, chemin réel, valeur copiée, `valueState`, correspondance éventuelle avec `factId` et stratégie d'identité. États de valeur : `present`, `absent`, `explicit-unknown`, `conflict` (date structurée explicitement inconnue mais chaîne legacy non vide). La présence d'une cible ne signifie pas que la valeur est vraie ou documentée.

## Inventaire couvert

| Propriétaire | Cibles R1 | Chemin et identité |
|---|---|---|
| Personne — identité | prénom, second prénom, nom de naissance, nom d'usage, sexe/genre enregistré | `people/{id}.{firstName,middleName,lastName,marriedName,gender}`. `name.given` et `name.birthSurname` réutilisent les `factId` existants ; les autres ont un ID namespace R1, sans prétendre à une correspondance historique. |
| Personne — naissance/décès | date et lieu séparés pour chaque événement | Date : `birthDateInfo`/`deathDateInfo` avec repli legacy `birthDate`/`deathDate`. Lieu : `place + birthPlaceInfo` / `deathPlace + deathPlaceInfo`. `birth.date`, `birth.place`, `death.date`, `death.place` réutilisent les identités existantes. Valeurs structured et legacy restent toutes deux visibles dans le registre. |
| Personne — variantes de nom | chaque variante « given » / « family » | `people/{id}.nameVariants[{variant.id}].value`. ID dérivé du propriétaire, de la collection et de l'ID persistant de variante ; jamais de la valeur ou de sa position. |
| Personne — Parcours | chaque résidence : date, lieu, adresse ; chaque profession : libellé, date, lieu ; chaque événement : type, libellé, date, lieu | `residences[{id}]`, `professions[{id}]`, `lifeEvents[{id}]`. ID basé sur l'ID propriétaire et l'ID persistant d'entrée. `notes`, descriptions narratives, `showInLifeTimeline` et attestations sont exclus. |
| Famille — union à deux partenaires | partenaires, type, date, lieu, type/date/lieu de fin | `families/{id}.partnerIds`, `relationType`, `unionDateInfo` (replis `marriageDate`/`unionDate`), `unionPlace`/`unionPlaceInfo`, `endType`, `endDateInfo` (replis `separationDate`/`divorceDate`), `endPlace`/`endPlaceInfo`. L'union n'est exposée comme telle que si deux partenaires valides sont présents. IDs par ID de Foyer + champ. |
| Famille — filiation | lien parent-enfant effectif et type de filiation éventuel | Les paires sont celles produites par `normalizedParentChildLinks()` à partir de `partnerIds × childIds`. ID : `buildLegacyParentChildIdentityId(familyId,parentId,childId)` ; stratégie signalée `legacy-family-parent-child-tuple`. Type inconnu/absent reste distinct de la présence du lien. |

Champs explicitement exclus : `people.branch` (classement interne), `notes`, `photoUrl`, `lifeEvents.description`, attestations, fichiers/Documents, Sources, transcriptions, Preuves et Conclusions. La sépulture n'a aucun champ structuré Personne/Famille observé ; elle n'est présente que comme catégorie du formulaire de Preuve (`js/genealogy-proof-form.js`). Aucune cible n'est inventée pour elle.

Entrées répétées sans ID, avec ID dupliqué ou structure invalide, liens parent-enfant aux extrémités absentes/hors des listes de membres, et collisions d'IDs calculés sont retournés dans `excluded` plutôt que dotés d'un ID d'index/hash de valeur.

## Compatibilité des identifiants de Preuves

Correspondances exactes codées dans les tests existants :

| Cible | `factType` existant | `factId` |
|---|---|---|
| prénom | `name.given` | `buildFactIdentityId("person", personId, "name.given")` |
| nom de naissance | `name.birthSurname` | `buildFactIdentityId("person", personId, "name.birthSurname")` |
| date/lieu de naissance | `birth.date` / `birth.place` | tuple Personne + type correspondant |
| date/lieu de décès | `death.date` / `death.place` | tuple Personne + type correspondant |

Ces types sont exercés par `tests/genealogy-identities.test.mjs` et `tests/genealogy-proofs.test.mjs`. L'application accepte aussi des `factType` larges (`birth`, `death`, `marriage`, `residence`) dans le formulaire (`js/genealogy-proof-form.js`), qui ne distinguent pas date/lieu ni événements répétés. R1 expose `birth`/`death` comme **candidats ambigus** pour les cibles de naissance/décès ; `marriage` et `residence` ne sont pas projetés sur des cibles précises, car l'identité de champ/événement ne peut pas être établie sans ambiguïté. Aucun candidat ambigu n'est associé automatiquement. Les anciennes valeurs `factId` arbitraires ou les types non référencés ne sont pas remappés ; aucune donnée réelle n'a été lue.

Les IDs d'entrées `residences`, `professions`, `lifeEvents` et variantes sont persistants dans leur tableau mais l'application n'a pas encore de taxonomie de `factType` par entrée répétée : R1 leur donne un `targetId` stable namespace R1 et laisse `factId` nul. Les liens parent-enfant ont un tuple legacy stable seulement tant que le Foyer et les deux extrémités restent les mêmes ; le déplacement/recréation du lien sous un autre Foyer exige un ID relationnel persisté. Les helpers d'identité eux-mêmes indiquent cette limite (`js/genealogy-identities.js:1-8,47-64`).

## Affirmations documentaires et déductions — recommandation pour R2+

R1 ne les stocke pas. Modèle conceptuel à arbitrer avant toute persistance :

1. **Affirmation explicite** : transcription fidèle de ce que le document dit, forme source conservée, auteur/état de vérification, sujets éventuellement multiples, relation au fait et référence précise au document/page/passage/révision/citation.
2. **Déduction** : objet distinct qui référence une ou plusieurs affirmations, conserve règle/raisonnement, temporalité, indices favorables et contraires, et reste « hypothèse » tant qu'un humain ne décide pas.
3. **Fait retenu** : valeur actuelle du modèle Personne/Famille ; aucune promotion automatique depuis une assertion ou une déduction.

Exemple : « veuve d'Andrea » dans un acte est une affirmation citée ; « Andrea est mort avant la date de cet acte » est une déduction bornée, pas une date de décès précise.

## Évolutions nécessaires / points à arbitrer

- Définir le dictionnaire canonique exact de `factType` et la table de migration/revue des types larges existants ; ne pas fusionner `birth` avec `birth.date` sans vérification humaine.
- Définir comment lier un même Document à plusieurs affirmations/faits (plusieurs Preuves existantes ou extension additive de leur référence documentaire). Le modèle Preuve porte actuellement un `documentId` singulier ; le sélecteur partagé est multisélection, mais `readProofGuidedFields()` ne sérialise que le premier (`js/app.js:12274-12298`).
- Décider la persistance d'ID parent-enfant si l'identité doit survivre à la reconstitution des Foyers.
- Concevoir une indexation/recherche des transcriptions complètes sans lire toutes les collections à chaque session ; actuellement les snapshots sont chargés en entier et la recherche carte d'une transcription ne prend que le premier passage (`js/app.js:14684-14720,6441-6452`).
- La suppression Personne ne met pas explicitement à jour les `personIds` des Sources/Preuves/Conclusions (`js/app.js:15594-15611`); suppression Document contrôlée côté client mais autorisée directement par Rules (`firestore.rules:545-547`). Concevoir le traitement des références historiques/orphelines avant une migration ou un nettoyage.
- Les Rules contrôlent l'enveloppe/version des objets officiels, mais ne valident pas en profondeur le schéma du champ `data` (`firestore.rules:404-410`). Les validateurs applicatifs (`genealogy-proofs.js`, `fact-conclusions.js`) et `verifyProofReferences()` ne constituent pas un contrôle Firestore exhaustif ; ce dernier helper n'est pas appelé par l'application actuelle.

**Aucun de ces éléments n'a été modifié ni migré dans R1.** Les références ci-dessus décrivent des dépendances à traiter dans un lot ultérieur après arbitrage.
