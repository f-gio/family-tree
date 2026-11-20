# Rapport QA — fiche Source dédiée (lot B)

> Rapport historique du lot B : les constats et résultats ci-dessous sont ceux consignés lors de ce lot ; ils n'ont pas été réexécutés ni actualisés lors de leur intégration documentaire.

## Périmètre

La consultation des Sources est routée vers `sourceDetailView`. La Preuve et le Document restent en modales. Pages/photos, formulaires, droits, archivage/restauration et suppression réutilisent les données et mécanismes existants ; aucun modèle ni accès Firestore n'a été modifié.

## Vérifications

- Test navigateur local avec données synthétiques en mémoire : Archives → Source → Archives (filtres et défilement), Source ↔ Document, Document → Source → Document, Source → Preuve → Source, Source → Atelier → Source par bouton et Retour navigateur.
- Contrôles responsive à 320 et 390 px : aucun débordement horizontal, cibles tactiles mesurées ≥ 44 px.
- Suites : `source-detail-page`, `genealogy-workspace-ui`, `final-qa`, `modals-forms-ui`, `responsive-accessibility`, `tile-context-menu-responsive` — réussies.
- `proof-guided-creation.test.mjs` : parcours d'écriture ignoré, émulateur Firestore local non configuré. Aucun test n'a contacté les données de production.

## Vérification manuelle restante

Confirmer sur une Source réelle les variations de champs optionnels, les associations documentaires/transcriptions historiques, les photos/aperçus disponibles, les actions d'administration (réviser, archiver/restaurer, suppression) et la lecture sur Safari iOS.
