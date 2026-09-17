# Rapport de validation — sections 17 à 22

## Périmètre

La passe couvre uniquement la visibilité de l’état du système, les actions
destructives, les menus et la navigation, les états vides, les cartes et les
icônes. Les sections 1 à 16 restent la référence ; les sections 23 et suivantes
n’ont pas été commencées.

## Contrôles exécutés

- contrôle de syntaxe de `app.js`, `tree-renderer.js` et `ui-components.js` ;
- suite de régression existante du Design System, des modales/formulaires, du
  modèle généalogique et des 70 parcours historiques ;
- test spécifique des trois types de notification et des états `aria-busy` ;
- test des libellés et confirmations de suppression/dissociation ;
- test des attributs actifs et accessibles de navigation et de menu ;
- test des états vides avec ou sans action contextuelle ;
- test des tokens communs des cartes et conteneurs ;
- test de la famille SVG, de ses tailles et des noms accessibles ;
- comparaison binaire de `firestore.rules` avec la V16.

## Résultat

Tous les contrôles de syntaxe et tests automatisés disponibles passent. Les
règles Firestore sont strictement inchangées. Aucun appel `alert()` concurrent
n’est présent : les retours persistants utilisent le composant de notification,
tandis que les confirmations natives restent réservées aux actions importantes.

## Limite d’environnement

Un scénario Playwright pour 1440, 1024, 768 et 390 px est fourni, mais n’a pas
pu être exécuté dans cet environnement car le binaire Chromium n’est pas
installé. Il se termine explicitement en statut « non exécuté » au lieu de
présenter le responsive comme validé visuellement. Les règles CSS et cibles
tactiles sont néanmoins couvertes statiquement.

Les interactions Firebase réelles n’ont pas été exécutées, faute de session
authentifiée et afin de ne pas modifier les données de production.

## Données et Firebase

Aucune migration, écriture de masse, nouvelle collection, nouvelle règle ou
modification du format des documents n’a été introduite.
