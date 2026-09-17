# Family Tree — modales et formulaires

Périmètre : sections 8 à 16 uniquement. Le Design System V15 reste la référence.
Firebase, le modèle de données et les opérations métier ne sont pas modifiés.

## Structure commune

Les fenêtres utilisent quatre zones :

1. en-tête avec titre, contexte et fermeture ;
2. navigation lorsque plusieurs sections équivalentes existent ;
3. contenu central défilant ;
4. actions persistantes en pied de fenêtre.

Quatre largeurs sont définies dans le Design System : Small (`28rem`), Medium
(`36,25rem`), Large (`45rem`) et Extra Large (`57,5rem`, soit 920 px). La fiche
Personne utilise la variante Extra Large sur les écrans qui le permettent ; la
fenêtre Paramètres conserve la variante Large. Elles gardent une hauteur stable
adaptée au viewport. Sur mobile, les grandes fenêtres deviennent presque plein
écran sans réduire la taille des champs.

## Formulaires structurés

- Personne : Identité, Événements de vie, Informations complémentaires.
- Lien parent-enfant : Personnes concernées et filiations clairement libellées.
- Document : Identification, Source, Association et notes.
- Tâche : Organisation, Détails du suivi.
- Relation : Union, Fin de relation, Filiations, séparées par l'espace et un
  filet léger plutôt que par plusieurs grosses cartes.

Le rythme utilise trois niveaux : 8 px entre label et champ, 16 px entre champs
d'un groupe et 24 px entre catégories.

## Divulgation progressive

- Les formats de date affichent uniquement la saisie utile au type choisi.
- Les champs de séparation/divorce ne sont visibles que si la relation possède
  effectivement une fin.
- Les sections Liens familiaux et Documents associés restent disponibles dans
  la fiche, mais expliquent qu'une identité doit d'abord être enregistrée.
- Aucune donnée déjà saisie n'est masquée arbitrairement ou remplacée par une
  valeur inventée.

## Labels et composants

- Tous les champs principaux conservent un label visible au-dessus du contrôle.
- Les types de filiation du lien manuel possèdent désormais leur propre label.
- Les cinq précisions de date restent un contrôle segmenté, car les choix sont
  courts et mutuellement exclusifs.
- Les listes de personnes et les listes métier restent des sélecteurs natifs :
  elles préservent le clavier, le tactile et le fonctionnement existant sans
  introduire un composant personnalisé fragile.

## Validation

Le module `js/form-ui.js` complète la validation native sans modifier les
données enregistrées. Il fournit des messages locaux et actionnables pour :

- les champs obligatoires ;
- les adresses e-mail et URL ;
- les longueurs et plages numériques ;
- les dates généalogiques précises, par année ou entre deux années ;
- l'ordre des bornes d'une période ;
- la présence d'un fichier ou d'un lien lors de la création d'un document ;
- la confirmation du mot de passe à l'inscription.

Une erreur ajoute `aria-invalid` et `aria-describedby`, place le message à côté
du champ, puis disparaît dès que la valeur est corrigée. Les autres valeurs du
formulaire ne sont jamais effacées.

Les sections 17 et suivantes ne sont pas traitées dans cette version.
