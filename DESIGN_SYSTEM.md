# La Nostra Storia --- Design System

> Référence synthétique à transmettre à Work/OpenCode pour préserver
> l'identité visuelle de l'application.

## 1. Direction visuelle

La Nostra Storia doit rester sobre, patrimoniale, chaleureuse et
éditoriale : fonds crème/surfaces claires, verts sourds, bordures
discrètes, ombres faibles et couleurs sémantiques peu saturées.

Principes : - utiliser les tokens CSS existants avant toute valeur codée
en dur ; - conserver une hiérarchie claire et une bonne densité ; -
privilégier les surfaces neutres et les accents ponctuels ; - utiliser
la couleur pour transmettre une information réelle ; - étendre les
composants existants plutôt que créer un système parallèle.

## 2. Architecture CSS

Deux couches principales : 1. styles historiques/spécifiques dans
`index.html` ; 2. `css/design-system.css`, chargé après et servant de
couche de design system.

À spécificité égale, `design-system.css` gagne. Toujours vérifier les
styles existants avant d'ajouter une règle.

## 3. Couleurs

Réutiliser les variables `--color-*`, notamment : - `--color-surface` :
surface principale claire ; - `--color-surface-raised` : surface
légèrement relevée / hover ; - `--color-border-subtle` : bordure
discrète ; - `--color-border` : bordure plus présente ; - tokens `brand`
/ `brand-soft` : identité et états positifs ; - tokens `danger` /
`danger-soft` : erreur, suppression, retard.

Règle sémantique : - neutre = état standard ; - vert doux = positif /
terminé ; - ambre-or doux = en cours / attention modérée ; - rouge doux
= erreur / suppression / retard réel.

Le rouge ne doit pas servir de décoration ni coder une simple priorité.

## 4. Typographie

Échelle existante approximative : `--text-xs: 0.6875rem` jusqu'à
`--text-2xl: 1.5rem`.

Hiérarchie : - titre de vue : fortement identifiable ; -
eyebrow/surtitre : petit, espacé, souvent en capitales ; - titre
d'élément : information principale ; - description : secondaire et
discrète ; - labels : compacts et lisibles ; - métadonnées :
visuellement secondaires.

Éviter les nouvelles tailles arbitraires lorsqu'un token existe.

## 5. Espacements

Échelle `--space-1` → `--space-12`, environ 4 → 48 px.

À utiliser pour gaps, padding, marges, formulaires et séparation des
sections.

## 6. Rayons, bordures, ombres et hover

Réutiliser `--radius-*`, `--color-border-subtle`, `--color-border`,
`--shadow-low`.

Style : - bordures fines et chaudes ; - rayons modérés ; - ombres très
légères ; - pas d'effet de carte flottante excessif.

Hover desktop : - variation de surface légère ; - éventuellement
`--shadow-low` ; - aucune translation ni changement de géométrie ; -
jamais de grosse surface marron/foncée ; - utiliser
`@media (hover: hover)` pour éviter les faux hover tactiles.

## 7. Contrôles et accessibilité

Token clé : `--control-touch: 2.75rem` = 44 px.

Préserver : - cibles tactiles ≥44 px ; - `:focus-visible` ; - navigation
clavier ; - attributs `aria-*` ; - `prefers-reduced-motion` ; -
`forced-colors` ; - labels accessibles.

Sur mobile, conserver une taille de texte suffisante dans les champs
pour éviter le zoom iOS.

## 8. Boutons

Primaire : fond vert de marque, texte contrasté, une action dominante
par zone. Exemple : `+ Ajouter une action`.

Secondaire/tertiaire : surface neutre ou bouton texte. Exemple :
`Ouvrir`.

Destructif : discret dans une liste mais explicite et accessible ;
couleur danger, cible tactile suffisante, `aria-label`, confirmation si
suppression définitive.

## 9. Badges / pills

Utilisés pour priorité, statut, filtres actifs et catégories.

Ils doivent rester compacts, arrondis et peu saturés. Ne pas coder deux
fois la même information sans raison.

## 10. Listes

Annuaire, Documents, Démarches et Actions doivent partager un langage
commun : - surface claire ; - bordure neutre discrète ; - bonne densité
; - titre dominant ; - métadonnées secondaires ; - actions à droite sur
desktop.

Éviter les grosses cartes lorsqu'une liste compacte suffit.

Un liseré coloré doit rester exceptionnel et sémantique. Exemple : une
Action réellement en retard peut recevoir un fond rouge très léger, un
liseré danger à gauche et le texte « En retard » rouge. Pas de liseré
permanent selon priorité/statut.

## 11. Formulaires

-   réutiliser les inputs/selects/textareas existants ;
-   grille lisible desktop ;
-   une colonne mobile si nécessaire ;
-   labels explicites ;
-   éviter les champs inutiles ;
-   préserver la compatibilité legacy.

## 12. Modales

Réutiliser les patterns `modal-md`, `modal-lg`, `modal-xl`.

Token connu : `--modal-max-height: calc(100dvh - 1.75rem)`.

Principes : - desktop : modale centrée et arrondie ; - mobile :
adaptation ou plein écran selon le composant ; - utiliser `dvh`/`svh` et
les safe areas iOS ; - éviter les scrolls imbriqués ; - éviter
`overflow-x:auto` involontaire ; - garder les actions principales
accessibles sans masquer le contenu.

## 13. Responsive

Breakpoints de référence : - ≤390 px : très petit mobile ; - ≤560 px :
plusieurs modales plein écran ; - ≤760 px : breakpoint mobile principal
; - 761--980 px : tablette/intermédiaire ; - adaptations supplémentaires
jusqu'à environ 1180 px.

Tokens connus : - `--breakpoint-mobile: 760px` -
`--breakpoint-tablet: 980px`

Validation recommandée : 320 / 390 / 430 / 760 / 1024 / 1440 px. Aucun
overflow horizontal involontaire.

## 14. Mobile / iOS

Patterns à préserver : - `100dvh` / `100svh` ; -
`env(safe-area-inset-*)` ; - cibles ≥44 px ; - champs évitant le zoom
iOS ; - layouts 1 colonne lorsque nécessaire.

Ne pas masquer un problème de largeur avec `overflow-x:hidden` sans
corriger sa cause.

## 15. Icônes

Utiliser le sprite SVG inline existant : - traits simples ; - même
famille visuelle ; - taille cohérente ; - pas de nouvelle bibliothèque
pour une icône ; - label ou `aria-label` lorsque nécessaire.

## 16. Pattern spécifique --- Actions

Structure desktop cible :
`Titre / description | Responsable | Échéance | Priorité | Statut | Ouvrir | ×`

Filtres : `Recherche | Mes actions | Responsable | Statut | Échéance`

États : - À faire : neutre ; - En cours : ambre/or doux ; - Terminée :
vert doux ; - En retard : rouge doux + liseré danger gauche.

Le retard est indépendant du statut et de la priorité. `Mes actions`
doit être un toggle/bouton-filtre compact, pas une checkbox brute.

## 17. À éviter

-   valeurs CSS arbitraires lorsqu'un token existe ;
-   nouvelles couleurs inutiles ;
-   ombres fortes ;
-   hover foncé ;
-   animations décoratives ;
-   composants surdimensionnés ;
-   duplication de codes couleur ;
-   scroll horizontal mobile ;
-   nested scrolling dans les modales ;
-   modification globale pour corriger un cas local ;
-   copie graphique de Tiny Houses : reprendre ses bonnes pratiques UX,
    pas son identité.

## 18. Checklist UI

Avant validation : 1. comparer aux patterns existants ; 2. vérifier les
tokens ; 3. tester desktop/mobile ; 4. vérifier
320/390/430/760/1024/1440 si pertinent ; 5. vérifier l'absence
d'overflow horizontal ; 6. vérifier hover et tactile ; 7. vérifier focus
clavier ; 8. vérifier cibles tactiles ; 9. vérifier que les états
restent compréhensibles sans couleur seule ; 10. ne jamais modifier
Firestore pour une correction purement visuelle.

## Fichiers de référence

-   `css/design-system.css` --- source principale des tokens/composants.
-   `index.html` --- styles historiques et spécifiques.
-   `js/app.js` --- rendu/comportements UI.
-   `AGENTS.md` --- règles permanentes de sécurité/développement.

**Principe directeur : étendre le design system existant plutôt que
créer un système parallèle.**
