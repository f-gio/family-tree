# La Nostra Storia — Sources et preuves généalogiques

## Objet du document

Document de référence unique pour centraliser les décisions fonctionnelles, techniques et le suivi du projet « Sources et preuves généalogiques ».

Ce document consigne les décisions communiquées et l'état connu du lot 0. Il ne remplace pas le cahier des charges fonctionnel détaillé. Lorsqu'un détail n'est pas disponible, il est indiqué « À confirmer » plutôt que déduit ou inventé.

## A. Objectifs et principes

### Objectifs

- Relier les documents historiques aux faits généalogiques précis.
- Conserver les sources originales et leur provenance.
- Permettre les transcriptions, traductions et corrections.
- Gérer les preuves concordantes ou contradictoires.
- Garantir la traçabilité des contributions.
- Préserver les données et associations existantes.

### Principes non négociables

1. Une preuve ou une conclusion ne modifie jamais automatiquement les données de l'arbre généalogique.
2. Les documents originaux sont à conserver.
3. Les faits et relations référencés doivent pouvoir être identifiés durablement.
4. Les modifications et décisions doivent être traçables selon les permissions validées.
5. Les preuves contradictoires ne sont pas supprimées au seul motif qu'une autre conclusion est retenue.
6. Les faits, les preuves et les conclusions restent des objets conceptuellement distincts.
7. Les autorisations doivent être imposées au niveau des données, et pas seulement dans l'interface.
8. Les sauvegardes et restaurations doivent être testées progressivement avant publication.

## B. Les neuf chapitres fonctionnels

Les neuf chapitres sont annoncés dans le périmètre fonctionnel. Leurs intitulés détaillés, critères et règles propres ne sont pas présents dans la documentation du dépôt consultée lors de la préparation de ce document. Ils ne sont donc pas reconstitués ici.

| Chapitre | Intitulé détaillé | Exigences connues consignées ici |
|---:|---|---|
| 1 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 2 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 3 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 4 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 5 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 6 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 7 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 8 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |
| 9 | À reprendre du cahier fonctionnel validé | Les objectifs transversaux et principes non négociables de la section A s'appliquent. Détails spécifiques : à confirmer. |

**Action documentaire nécessaire :** intégrer ultérieurement les titres et exigences exacts depuis le cahier fonctionnel validé, sans les paraphraser au point d'en changer le sens.

## C. Arbitrages fonctionnels A-01 à A-08

- **A-01 — Changement d'identification :** une modification d'identification d'une personne suspend les preuves concernées jusqu'à vérification.
- **A-02 — Imprécisions :** préserver les imprécisions historiques plutôt que fabriquer des dates ou valeurs exactes.
- **A-03 — Doublons et images :** détecter les doublons par SHA-256 et rapprochements probables ; permettre plusieurs photographies d'une même page.
- **A-04 — Révision de transcription :** une révision affectant un passage cité entraîne une vérification des preuves concernées.
- **A-05 — Relations invalidées :** conserver les relations familiales invalidées et leurs identifiants historiques, sans les réintroduire automatiquement dans l'arbre.
- **A-06 — Contributeurs en sauvegarde :** restaurer les identifiants historiques des contributeurs, sans restaurer les comptes Firebase Authentication.
- **A-07 — Sauvegardes progressives :** prévoir et tester une sauvegarde/restauration à chaque lot concerné, sans attendre la fin du projet.
- **A-08 — Passages :** utiliser des identifiants permanents de passages indépendants des numéros de ligne ; conserver les citations figées et distinguer l'état technique d'une preuve de son appréciation généalogique.

## D. Décisions techniques

### T-01 — Stockage documentaire

Décision de travail consignée :

- Firebase Cloud Storage est prévu pour les originaux immuables.
- Les prévisualisations sont séparées des originaux.
- La conservation exacte des fichiers originaux est exigée.
- Une empreinte SHA-256 est prévue.
- Les métadonnées restent dans Firestore.
- Les anciens documents stockés dans `documentChunks` restent compatibles.
- La sauvegarde ZIP autonome comprend les fichiers.
- L'objectif budgétaire indicatif est d'environ 3 €/mois.
- Les tarifs et risques doivent être vérifiés avant toute activation de Blaze.

**Limite de validation :** la présence, l'activation, la région, le plan et les tarifs Cloud Storage n'ont pas été établis par ce document. Aucune activation n'est autorisée implicitement par la consignation de T-01.

### T-02 — Sécurité et historique

Décision de travail consignée :

- Sécurité des accès Firestore par Security Rules renforcées.
- Transactions atomiques côté client pour les opérations concernées.
- Révisions et historique immuables vis-à-vis des utilisateurs autorisés par les Rules.
- Conclusions réservées aux administrateurs.
- Tests des règles par Firebase Emulator.
- Ne pas présenter les Rules comme une protection contre les accès privilégiés IAM/Admin SDK.

## E. Suivi des lots

### Découpage retenu

| Lot | Périmètre | Dépendances | Critères de validation | Statut |
|---:|---|---|---|---|
| 0 — Fondations des identifiants | Identifiants stables de faits et fondation pure des relations/invalidation. Fichiers : `js/genealogy-identities.js`, `tests/genealogy-identities.test.mjs`. Aucun stockage relationnel Firestore intégré. | Aucun lot antérieur. | Tests du module et non-régression locale : 45 réussis, 0 échec selon le rapport de validation. | **Terminé** — commit local `65ee5d2` (`65ee5d2ce53559eb8d8fa4545189ebc3194bfbc8`). Aucun déploiement. |
| 1 — Modèle des sources et documents | Documents, pages, photographies, métadonnées archivistiques, SHA-256, compatibilité avec l'existant. | Lot 0 (identifiants de faits). | À confirmer. | À confirmer. |
| 2 — Conservation des fichiers | Originaux immuables, aperçus séparés, stockage, consultation multipage, intégrité. | Lot 1 (modèle documentaire). | À confirmer. | À confirmer. |
| 3 — Transcriptions et traductions | Italien, français, versions, passages permanents, incertitudes. | Lot 1 (pages et passages). | À confirmer. | À confirmer. |
| 4 — Preuves généalogiques | Liens plusieurs-à-plusieurs entre sources et faits, citations, contradictions, faits vides et relations historiques. | Lots 0, 1 et 3. | À confirmer. | À confirmer. |
| 5 — Conclusions et contradictions | Confrontation des affirmations, conclusion globale manuelle, accès administrateur. | Lot 4 (preuves). | À confirmer. | À confirmer. |
| 6 — Collaboration et sécurité | Auteurs, propositions, notifications, historique, permissions et transactions. | Lots 1 à 5. | À confirmer. | À confirmer. |
| 7 — Sauvegarde et restauration | Sauvegarde autonome, fichiers originaux, compatibilité v4, intégrité et restauration vérifiée. | Lots 1 à 6. | À confirmer. | À confirmer. |
| 8 — Intégration finale et recherche | Fiches personnes/familles/documents, navigation, recherche, responsive et tests de bout en bout. | Lots 1 à 7. | À confirmer. | À confirmer. |

### Règles transversales aux lots

- Les tests, la sécurité et la récupération des données sont pris en compte dès les premiers lots concernés, pas reportés à la fin du projet.
- Le lot 6 ne reporte pas à plus tard les contrôles de sécurité indispensables aux lots précédents ; il les consolide et les étend.
- Le lot 7 ne reporte pas à plus tard la sauvegarde des nouvelles données ; chaque lot concerné prévoit et teste sa sauvegarde/restauration.
- Aucun lot ne modifie automatiquement les valeurs généalogiques de l'arbre.
- Toute activation Blaze ou publication nécessite une autorisation explicite.
- Le travail s'effectue sur `recette`, sans toucher à la production.

## F. Règles de développement

- Travailler sur la branche `recette`.
- Réaliser un lot à la fois.
- Tester et valider chaque lot avant de poursuivre.
- Préserver les données historiques et la compatibilité des documents existants.
- Vérifier la sauvegarde/restauration progressivement, à chaque lot concerné.
- Ne jamais déployer sans autorisation explicite.
- Après toute publication autorisée, revenir sur `recette` et la synchroniser selon le workflow du projet.
- Proposer une publication uniquement lorsqu'un ensemble cohérent de fonctionnalités est validé.
- Toute modification des Firestore Rules doit être traitée comme un changement sensible et validée séparément.

## Historique des décisions et du document

| Entrée | État |
|---|---|
| Arbitrages fonctionnels A-01 à A-08 | Décisions fournies comme validées ; consignées dans la section C. |
| Décisions techniques T-01 et T-02 | Consignées dans la section D ; activation de service et tout déploiement restent soumis à autorisation et vérifications séparées. |
| Lot 0 | Terminé au commit local `65ee5d2` ; aucun déploiement selon le périmètre fourni. |
| Découpage des lots 1 à 8 | Découpage désormais retenu et consigné dans la section E ; critères de validation détaillés : à confirmer avant chaque lot. |
| Cahier détaillé des neuf chapitres | Titres et texte source à intégrer depuis la version validée ; non reconstitués ici. |
