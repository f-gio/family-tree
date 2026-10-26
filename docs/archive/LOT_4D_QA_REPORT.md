# Lot 4D — Transfert multiple entre arbres

## Résumé

Une fonction de transfert groupé a été ajoutée à l'Annuaire pour les administrateurs. Elle prolonge le transfert individuel 4C sans le remplacer. L'opération déplace uniquement les fiches choisies, dans une transaction Firestore unique, après aperçu et revalidation.

### Correctif de synchronisation clavier (recette Lot 4D)

Un test Playwright a reproduit le cas silencieux : après avoir choisi Jean par clic puis Paul avec Entrée, les chips affichaient les deux noms, mais le compteur/aperçu et la transaction ne contenaient que Jean. Le picker déclenchait la synchronisation applicative par clic sur le conteneur ; son ajout clavier appelait directement `add()` sans événement click. `createPersonMultiSelect` notifie désormais `onChange` après chaque ajout/retrait effectif ; le transfert multi s'abonne à ce callback. Une sélection entrée au clavier, cliquée ou retirée met à jour les mêmes IDs, compteur, aperçu et payload. Les pickers Documents/Démarches n'ayant pas ce callback optionnel gardent leur comportement.

## Sélection et destinations

- Recherche multi-personne réutilisant `createPersonMultiSelect` ; sélection, retrait par personne et vidage de la sélection.
- Les doublons sont évités par l'ensemble des IDs du picker. Toutes les personnes doivent être dans le même arbre source.
- `treeId` absent, `null` et `"main"` restent l'arbre principal. `inTree: false` est conservé ; le dialogue l'indique et le transfert ne rend pas la fiche visible.
- Maximum : **20 personnes** par opération, appliqué au picker et au plan. Cela limite à 20 écritures sur le maximum Firestore de 500 par transaction (4 % du plafond).
- Budget distinct : **100 documents lus au plus** (personnes sélectionnées et références, foyers, arbre(s) secondaire(s)). Le contrôle intervient avant la lecture complète, au plan, et juste avant les écritures pour borner coût et durée.
- Destinations possibles : arbre principal, arbre secondaire existant, autre arbre secondaire existant. L'arbre source est exclu ; aucun arbre n'est créé.

## Aperçu et relations

L'aperçu affiche source, destination, personnes sélectionnées, nombre de foyers et membres, liens internes au groupe, liens avec des personnes non sélectionnées, liens déjà répartis dans d'autres arbres, visibilité avant/après et fiches masquées. Aucun ajout ou déplacement familial automatique n'est effectué.

Les relations (foyers, `partnerIds`, `childIds`, `parentChildLinks`, `links`) ne sont jamais écrites par le transfert. Seuls les documents `people/{id}` explicitement sélectionnés sont mis à jour (`treeId`; `updatedBy*` uniquement selon la même exigence que le transfert 4C). Documents, notes, photos, branches et tâches restent intacts.

## Concurrence et atomicité

- Validation administrateur, existence et arbre source de chaque personne, destination existante et noms des arbres.
- Découverte fraîche des foyers concernés, puis relecture transactionnelle de toutes les personnes référencées et foyers découverts.
- Fingerprint agrégé réutilisant la canonicalisation canonique 4C ; les changements réels invalident l'aperçu.
- Toutes les lectures et validations précèdent toutes les écritures. Le commit Firestore est indivisible ; erreur = zéro déplacement partiel.
- Limite connue du SDK Web : les familles ajoutées après les requêtes de découverte ne peuvent pas être verrouillées par la transaction ; le code et l'aperçu ne prétendent pas détecter/verrouiller ce cas.

## Interface et permission

Le bouton de transfert multiple est seulement visible pour les administrateurs lorsque les personnes, foyers et arbres sont chargés. Le callback et les règles Firestore exigent toujours un administrateur. Dialogue de recherche/aperçu/confirmation avec états vides, limite, erreur, annulation, cibles tactiles et mise en page 390 px.

## Tests exécutés

- Modèle + diagnostic + Firebase/environnements + garde + build-environment : **61/61**.
- Dialogue multi (clic/Entrée, IDs transmis, limites, source unique, retrait/vidage, conflit, aperçu obsolète, personne supprimée, arbre cible absent, permissions, 390 px) : **11/11**.
- Transfert individuel 4C : **10/10**.
- Création/affectation 4B + bouton central arbre vide : **14/14**.
- Annuaire, sauvegarde/restauration, règles de langue, QA final 70 cas, mise à jour, responsive/accessibilité : **121/121**.
- Firestore Emulator local protégé : **63/63**, dont transfert multiple à 2 fiches, annulation atomique après conflit de relation et groupe à 20 écritures.
- Syntaxe `node --check` : `js/app.js`, `js/tree-model.js`, `tests/firestore-emulator.mjs` validés.
- `npm.cmd run build:recette` : réussite ; 32 ressources servies localement.
- Commande agrégée `node --test tests/` non prise en charge par le Node Windows utilisé (le runner essaie de résoudre le dossier comme un module) ; les suites ciblées ci-dessus ont été exécutées individuellement.

## Build, règles et environnement

Le build Recette fabrique un résolveur Firebase limité aux projets Recette et Emulator local ; la config Production est retirée de `dist-recette` et son origine y est refusée. Le module source commun utilisé par Production reste inchangé. L'artefact exclut `firestore.rules` ; ces règles n'ont pas été modifiées.

## Recette manuelle proposée

1. Sur Recette, en administrateur, ouvrir Annuaire → « Transférer plusieurs personnes ».
2. Sélectionner Paul et Sophie dans le même arbre (tester un ajout par clic et un ajout par Entrée), confirmer que la destination est « Giovannoni Orino », et lire les liens internes et externes.
3. Annuler ; vérifier qu'aucun `treeId` n'a changé.
4. Refaire l'opération puis confirmer ; vérifier uniquement les personnes sélectionnées dans l'arbre cible, annuaire partagé sans doublons, relations conservées et visibilité conforme.
5. Répéter vers l'arbre principal et entre deux arbres secondaires ; tester aussi un groupe contenant une fiche `inTree: false`.

**Aucun déploiement Hosting ni Firestore Rules effectué dans ce lot.**
