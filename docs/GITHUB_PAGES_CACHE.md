# Versionnement des ressources GitHub Pages

## Mécanisme

`index.html` porte un identifiant `asset-release`. Le même jeton est ajouté en paramètre `v` aux feuilles CSS, images d’interface et deux points d’entrée modules. Une import map applique ce jeton à toutes les dépendances JavaScript locales, y compris les imports imbriqués des modules.

Pour chaque publication, remplacer **toutes** les occurrences de l’ancien jeton dans `index.html` par un nouvel identifiant unique de release. Ne pas changer les chemins relatifs : ils restent résolus sous `/family-tree/` sur GitHub Pages et depuis la racine de Recette. Les URL Firebase/CDN externes ne sont pas réécrites. Aucun Service Worker n’est utilisé.

Les URL avec un nouveau jeton forcent une nouvelle clé de cache pour les ressources CSS/JS lors du chargement d’un HTML à jour. Un onglet déjà ouvert garde son graphe de modules chargé ; une navigation qui reçoit le nouvel HTML demande les nouvelles URL versionnées.

## Limite connue

GitHub Pages sert ici `Cache-Control: max-age=600` et remplace le contenu aux chemins fixes ; il ne conserve pas les anciennes réponses selon la query `v`. Si un navigateur garde un ancien HTML en cache et qu’un de ses modules versionnés expire avant le document, le même ancien URL `?v=ancien` peut recevoir le contenu actuel du chemin. La stratégie minimise le risque et isole les chargements initiés depuis un HTML à jour, mais **ne constitue pas une garantie absolue contre tout client doté d’un HTML périmé**.

Une garantie stricte exigerait des URL de fichiers immuables par release, et la conservation des anciens répertoires/assets pendant la durée de vie des anciens HTML (ou une configuration de cache HTTP contrôlée). Cela implique un artefact de publication/Pages supplémentaire et n’est pas ajouté dans ce correctif pragmatique.

## Recette

`npm.cmd run build:recette` utilise le même `index.html` et suit les URL relatives avec query string. Le build continue de transformer `firebase-environment.js` pour exclure Production ; le versionnement des URL n’ajoute ni ne modifie de projet Firebase.
