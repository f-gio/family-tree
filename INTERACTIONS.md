# Family Tree — langage d’interaction (sections 17 à 22)

Cette évolution harmonise les retours d’état, les actions sensibles, les menus,
les états vides, les surfaces et les icônes. Elle prolonge le Design System
existant sans modifier Firebase, les données ni les parcours métier.

## États du système

- un seul composant de notification pour les succès, informations et erreurs ;
- message annoncé par les aides techniques avec `aria-live` ;
- état de synchronisation visible : en cours, synchronisé ou erreur ;
- boutons désactivés et marqués `aria-busy` pendant les enregistrements afin
  d’empêcher les doubles soumissions ;
- validation de formulaire maintenue près du champ concerné.

## Suppression et dissociation

- rouge réservé aux opérations dangereuses ;
- suppression définitive explicitement distinguée de la dissociation ;
- confirmation réservée aux conséquences importantes ;
- confirmation d’une dissociation précisant que les fiches restent dans
  l’Annuaire ;
- actions dangereuses séparées du bouton principal dans les pieds de modale.

## Navigation et menus

- section principale identifiée par `aria-current` et le même indicateur actif ;
- menu du compte structuré comme un menu et fermé au clic extérieur ou avec
  `Échap` ;
- états hover, focus, active et disabled issus du Design System existant ;
- contrôles Liste/Cartes et boutons de l’arbre alignés sur les mêmes règles.

## États vides

Le composant commun contient un pictogramme, un titre, une explication courte et
une action uniquement lorsqu’elle est utile. Il couvre l’Arbre, l’Annuaire, les
Documents, les Tâches, les relations, les documents associés et
l’administration.

## Cartes et icônes

- surfaces basées sur les mêmes bordures, rayons, fonds et ombres ;
- ombre renforcée uniquement sur les cartes réellement interactives ;
- famille SVG outline unique ;
- tailles d’icône 14, 18 et 28 px ;
- bouton composé uniquement d’une icône doté d’un nom accessible et, lorsque
  pertinent, d’une infobulle native.

## Compatibilité

`firestore.rules` est identique à la version précédente. Aucun champ, document,
collection, règle d’accès ou format de sauvegarde n’a été modifié.
