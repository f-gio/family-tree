# Family Tree — rapport final des sections 30 à 34

## 1. Périmètre et méthode

Cette exécution est exclusivement une passe de protection fonctionnelle, de
cohérence, de mutualisation limitée et de QA finale. Aucune fonctionnalité,
direction graphique, collection Firebase ou migration n’a été ajoutée.

Les contrôles ont combiné :

- les huit suites automatisées du projet ;
- les vérifications de syntaxe JavaScript ;
- la comparaison exacte avec la V18 des règles Firebase et des modules métier ;
- une revue statique écran par écran du HTML, du CSS et des interactions ;
- des contrôles d’accessibilité structurelle : identifiants, références ARIA,
  focus, labels, types de boutons et navigation clavier ;
- les tests de calcul du layout, des relations, des dates, de l’Annuaire et des
  70 parcours historiques.

## 2. Problèmes réellement constatés et corrections

### Soumission involontaire depuis Liens familiaux

Les boutons dynamiques **Dissocier** étaient intégrés au formulaire Personne
sans `type="button"`. Leur activation pouvait donc également soumettre et
enregistrer la fiche. Ils possèdent maintenant un type explicite.

Le même garde-fou a été appliqué aux autres boutons d’action générés et aux
boutons de navigation. Cette correction ne change aucune action métier ; elle
empêche uniquement une soumission implicite présente ou future.

### Mutualisation tactile

Les hauteurs tactiles mobiles répétées utilisaient directement `2.75rem`.
Elles utilisent désormais le token existant `--control-touch`, dont la valeur
reste strictement identique. Aucun rendu n’est modifié.

## 3. Revue écran par écran

| Écran ou parcours | Contrôles réalisés | Résultat | Niveau de validation |
|---|---|---|---|
| Navigation principale | hiérarchie, onglet actif, CTA propres à l’Arbre, clavier, types de boutons, responsive | conforme | automatisé + statique |
| Arbre généalogique | layout, générations, liens, pan, zoom, rendu des cartes, état vide, ouverture d’une fiche | conforme dans les tests disponibles | automatisé + statique |
| Création Personne | sections, champs requis, validation, CTA principal, passage vers Liens familiaux | conforme | automatisé + statique |
| Modification Personne | préremplissage, sauvegarde, retrait de l’Arbre, suppression depuis l’Annuaire | conforme | automatisé + statique |
| Identité | regroupement, rythme, labels, dates, photo, clavier mobile et erreurs locales | conforme | automatisé + statique |
| Liens familiaux | partenaires, parents, enfants, détails, filiation, dissociation et confirmation | conforme après correction du bouton Dissocier | automatisé + statique |
| Documents associés | état vide, liste, consulter, modifier et rattacher | conforme | automatisé + statique |
| Création/modification document | titre facultatif, fichier ou URL, associations, validation, feedback et actions | conforme dans les tests disponibles | automatisé + statique |
| Annuaire Liste | identité principale, dates, documents, action Fiche, recherche, tri et filtres | conforme | automatisé + statique |
| Annuaire Cartes | contenu équivalent, CTA, grille et adaptation progressive | conforme dans les règles vérifiées | automatisé + statique |
| Recherche et filtres | mise à jour instantanée, critères, effacement, clavier mobile et panneau dans le viewport | conforme | automatisé + statique |
| Menus et dropdowns | états ouvert/fermé, Escape, flèches, focus, actions du compte | conforme | automatisé + statique |
| Confirmations | suppression définitive, dissociation, retrait de l’Arbre, restauration et réorganisation | cohérentes avec la gravité | statique |
| États vides | message, explication et CTA seulement lorsque pertinent | conformes et mutualisés | automatisé + statique |

## 4. Grille UX finale

- **Hiérarchie** : les titres d’écran, informations principales et métadonnées
  secondaires restent distincts.
- **CTA** : une action principale est conservée par contexte ; danger et
  dissociation restent visuellement secondaires.
- **Hick** : les informations complexes restent réparties entre onglets,
  filtres et divulgation conditionnelle.
- **Fitts** : les actions tactiles utilisent le token commun de 44 px.
- **Jakob** : onglets, menus, boutons, confirmations et fermeture des modales
  suivent les conventions déjà établies.
- **Formulaires** : groupes, labels et erreurs restent associés au bon contexte.
- **Modales** : header, navigation et footer sont stables ; le centre défile.
- **Feedback** : chargement, sauvegarde, succès et erreur restent annoncés.
- **Mobile** : les règles couvrent 760, 560 et 390 px sans transformer
  l’interface en simple miniature du desktop.
- **Desktop** : les paliers 1 180 et 980 px évitent la saturation de l’en-tête et
  des grilles.
- **Accessibilité** : focus visible, noms accessibles, rôles et références ARIA
  ont été contrôlés.
- **Cohérence** : les composants et tokens existants sont réutilisés ; aucun
  système concurrent n’a été ajouté.

## 5. Protection Firebase et données

Les éléments suivants sont identiques à la V18 :

- `firestore.rules` ;
- `tree-camera.js` ;
- `tree-layout.js` ;
- `family-relations.js` ;
- `genealogy-date.js` ;
- `directory-utils.js` ;
- `document-utils.js`.

Les collections `people`, `families`, `documents`, `tasks` et `users` restent
inchangées. Aucune migration, suppression, réécriture ou nouvelle propriété
Firebase n’a été introduite.

## 6. Tests exécutés

- 8 suites automatisées réussies ;
- 0 échec ;
- syntaxe valide pour tous les modules JavaScript principaux ;
- 260 identifiants HTML contrôlés, aucun doublon ;
- toutes les références `aria-controls` et `aria-labelledby` contrôlées ;
- tous les boutons statiques et générés possèdent un type explicite ;
- règles Firebase identiques à la référence V18 ;
- intégrité de l’archive ZIP vérifiée.

## 7. Contrôles non exécutables dans cet environnement

Le navigateur Chromium n’est pas installé. Le scénario Playwright couvrant
1 440, 1 180, 1 024, 900, 768, 600, 390 et 320 px est donc fourni mais marqué
**non exécuté**. Aucun rendu pixel, geste tactile réel, clavier iOS/Android ou
test avec lecteur d’écran réel n’est déclaré comme validé.

Les écritures Firebase, l’authentification réelle et l’envoi/lecture d’un fichier
de production n’ont pas été exécutés sans session authentifiée, afin de ne pas
modifier les données familiales existantes.

## 8. Validation de l’objectif final

Dans le périmètre réellement testable ici, Family Tree conserve son identité,
son modèle généalogique, son canvas infini, ses documents, son Annuaire et ses
permissions. La régression fonctionnelle détectée a été corrigée sans nouvelle
fonctionnalité. La validation visuelle sur navigateur et appareils réels reste
la seule étape manuelle explicitement ouverte.
