# Rapport de validation — sections 23 à 29

## Périmètre

La passe couvre l’adaptation mobile, les claviers de saisie, l’accessibilité,
les libellés, les transitions, la performance perçue et le responsive
progressif. Les sections 1 à 22 restent la référence. Les sections 30 à 34
n’ont pas été commencées.

## Contrôles réalisés

- syntaxe JavaScript de l’application et des moteurs d’arbre ;
- unicité de tous les identifiants HTML ;
- breakpoints 1 180, 980, 760, 560 et 390 px ;
- passage des listes et formulaires mobiles à une colonne ;
- filtres Annuaire sous forme de panneau tactile contenu dans le viewport ;
- modales importantes en plein écran jusqu’à 560 px ;
- cibles tactiles de 44 px ;
- attributs de clavier mobile pour e-mail, URL, années, recherches, noms et
  lieux ;
- focus visible, rôles des onglets, noms des boutons icônes et navigation aux
  flèches ;
- respect de `prefers-reduced-motion` ;
- états `aria-busy` et surfaces de chargement stables ;
- ratios de contraste : texte 12,95:1, texte secondaire 4,79:1, texte blanc sur
  la couleur de marque 9,68:1, danger 5,97:1 et labels 7,00:1 ;
- suite de régression des sections 1 à 22, du modèle généalogique et des 70 cas
  historiques ;
- comparaison exacte de `firestore.rules` avec la version de référence V17.

## Résultat

Tous les tests automatisés et contrôles statiques disponibles passent. Aucune
erreur de syntaxe n’a été détectée. Les règles Firestore sont strictement
inchangées et aucune migration n’a été ajoutée.

## Limites explicites

Le scénario Playwright couvre 1 440, 1 180, 1 024, 900, 768, 600, 390 et
320 px, mais n’a pas pu être exécuté ici car Chromium n’est pas installé. Il se
termine donc avec l’état explicite « non exécuté ». Le tactile réel, les
claviers iOS/Android et le rendu pixel sur appareils physiques restent à
confirmer après déploiement.

Les parcours Firebase réels n’ont pas été lancés sans session authentifiée afin
de ne pas écrire dans les données de production.
