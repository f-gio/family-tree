# Rapport QA — fiche Preuve dédiée (lot C)

> Rapport historique du lot C : les constats et résultats ci-dessous sont ceux consignés lors de ce lot ; ils n'ont pas été réexécutés ni actualisés lors de leur intégration documentaire.

## Périmètre

La consultation des Preuves utilise `proofDetailView`, avec retour contextuel vers Archives, Source, Document ou Personne. Source reste une page dédiée ; Document et Personne restent en modales. Révision, archivage, suppression, permissions et associations réutilisent les opérations existantes.

## Vérifications

- Parcours navigateur local sur données synthétiques : Archives↔Preuve (filtres/défilement), Source↔Preuve, Document↔Preuve, Personne↔Preuve, Preuve↔Source, Preuve↔Document.
- Champs métier, citations, interprétation, statuts, historique, états sans association et permissions vérifiés ; révision par la modale existante.
- Chromium à 320/390 px et desktop : pas de débordement horizontal, cibles tactiles ≥ 44 px.
- Suites ciblées : `proof-detail-page`, `source-detail-page`, `genealogy-workspace-ui`, `final-qa`, responsive, modales, tuiles et atelier — réussies.
- `proof-guided-creation.test.mjs` sous émulateurs locaux : 6 réussites, 8 échecs (1, 2, 4, 5, 6, 8, 9), identiques aux échecs préexistants constatés sur `e50ab96` ; les parcours 11–13 (suppression, navigation Document↔Preuve, révision) réussissent. Aucun PAGEERROR nouveau. Aucun accès Firestore distant.

## Vérification manuelle restante

Confirmer sur des Preuves réelles les références Source/Document, les variations de citations et les statuts archivés, les permissions par rôle, les retours imbriqués sur Safari iOS et les brouillons de Personne conservés au retour.
