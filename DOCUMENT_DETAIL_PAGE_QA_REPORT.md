# Rapport QA — page Document dédiée (lot D)

> Rapport historique du lot D : les constats et résultats ci-dessous sont ceux consignés lors de ce lot ; ils n'ont pas été réexécutés ni actualisés lors de leur intégration documentaire.

## Périmètre

Le lecteur JPEG/PDF a été migré de la modale `documentViewerDialog` vers la page dédiée `documentDetailView` : en-tête compact (Retour, titre, menu), onglets Original/Informations en mobile, deux panneaux indépendants en desktop. Les moteurs `createDocumentImageViewer`/`createDocumentPdfViewer`, les URL objet et le nettoyage sont réutilisés ; aucun modèle de données ni règle Firestore modifié.

## Parcours vérifiés (test `document-detail-page.test.mjs`, Chromium local)

- Archives → Document → Retour (filtres et défilement restaurés).
- Personne → Document → Retour Personne (section et brouillon restaurés).
- Document → Source → retour Document ; Document → Preuve → retour Document (contexte d'origine conservé).
- Document → Atelier → retour Document (contexte conservé, bouton Retour).
- Échap : retour direct à l'origine (ancien réflexe du lecteur).
- Mobile 320/390 px : aucun débordement horizontal, cibles ≥ 44 px, aucune erreur JS.

## Tests

- Nouveau : `tests/document-detail-page.test.mjs` (parcours + mobile).
- Adaptés à la page sans affaiblissement : `document-viewer-mobile` (20/20), `pdf-viewer-validation` (4/4), `document-viewer-pdf-production` (2/2, artefact `dist-production` rebuildé localement), `genealogy-workspace-ui`, `navigation-context`, `proof-guided-creation` (sélecteurs de volet + viewport desktop du sous-test 12), `source-detail-page`, `proof-detail-page`, `mobile-modal-sheets-lot1`.
- Campagne ciblée : 86 tests réussis (navigation, workspace, final-qa, modales, responsive, tuiles, atelier, hosting-cache, pages Source/Preuve/Document).

## Intégration Firestore (émulateurs locaux)

- `proof-guided-creation` : **6 réussites / 8 échecs — profil strictement identique à la référence `e50ab96`/`8b56bd6`** : échecs préexistants des sous-tests 1, 2, 4, 5, 6, 8, 9 (sélecteur de documents et cascade) + agrégé. Les sous-tests 11 (suppression), 12 (Document ↔ Source/Preuve) et 13 (révision) réussissent. Aucun PAGEERROR.
- Aucun accès aux données de production.

## Points de vigilance

- Le sous-test 12 nécessite désormais un viewport desktop explicite (le sous-test 7 laisse un viewport mobile résiduel partagé au test parent).
- Curiosité CSS sans effet visuel : un `border-radius: 16px` est mesuré sur `#documentDetailView` en mobile sans règle appariée identifiée (conteneur sans bordure ni fond — aucun impact visuel ; à requalifier si un arrondi devient visible).
- Vérification manuelle : rendu réel (JPEG volumineux, PDF multipages), Safari iOS, plein écran physique, et les deux cartes Sources/Preuves du volet sur mobile via l'onglet Informations.
