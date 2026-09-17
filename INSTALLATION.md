# Family Tree — installation

> Pour activer les suggestions mondiales de lieux, suivez également [GEONAMES.md](./GEONAMES.md). La saisie libre fonctionne même sans cette configuration.

Déposez à la racine de votre dépôt GitHub Pages :

- `index.html`
- `favicon.svg`
- le dossier `css`
- le dossier `js`

Le fichier de règles sert dans Firebase Console :

1. **Firestore Database → Règles** : copiez `firestore.rules`, puis publiez.

## Première connexion et administrateur

Après avoir remplacé les fichiers et publié les règles :

1. Connectez-vous immédiatement avec votre compte déjà créé dans
   **Firebase Authentication**.
2. Le premier compte qui se connecte initialise automatiquement l'espace et
   devient **administrateur principal**.
3. Après cette initialisation, le bouton **Créer un compte** apparaît sur la
   page de connexion.
4. Les nouveaux comptes restent en attente jusqu'à leur validation depuis le
   menu du profil → **Administration**.

L'administrateur principal ne peut pas être suspendu ou rétrogradé depuis
l'application. Les autres administrateurs peuvent accepter, refuser, suspendre
ou réactiver un membre et lui attribuer le rôle Membre ou Administrateur.

Chaque utilisateur dispose d'un menu de profil dans l'en-tête :

- **Mon profil** : nom affiché et photo compressée à 5 Ko maximum ;
- **Données** : sauvegarde ZIP complète et restauration contrôlée ;
- **Sécurité** : changement de mot de passe après confirmation du mot de passe
  actuel ;
- **Administration** : visible uniquement pour les administrateurs ;
- **Se déconnecter**.

## Navigation et affichage mobile

Les sections Arbre, Annuaire, Documents et Tâches utilisent une barre de
navigation distincte des boutons d'action. L'onglet actif est identifié par sa
couleur et un soulignement. L'icône `favicon.svg` apparaît dans l'onglet du
navigateur.

Sur téléphone, l'en-tête est réparti sur des lignes compactes : identité et
profil, navigation, puis actions propres à l'arbre. Les textes secondaires sont
réduits dans la vue Arbre afin de réserver davantage de hauteur au canvas. Le
positionnement et les dimensions des cartes restent identiques sur ordinateur.

Les documents envoyés sont limités à 20 Mo. Ils sont découpés en blocs dans
Firestore et restent accessibles uniquement aux utilisateurs connectés avec
Firebase Authentication. Firebase Storage n'est pas utilisé : le projet reste
compatible avec l'offre gratuite Spark, dans les limites des quotas gratuits
de Firestore.

Les images volumineuses sont automatiquement redimensionnées au maximum à
2 800 pixels et converties en WebP haute qualité uniquement lorsque le gain de
poids est significatif. Les petites images et les PDF sont conservés dans leur
qualité originale. Les nouveaux fichiers utilisent le type binaire Firestore,
ce qui évite le surpoids de l'ancien encodage Base64. Les anciens documents
restent lisibles.

Les menus **Annuaire**, **Documents** et **Tâches** proposent une vue en cartes
et une vue en liste plus synthétique. Le choix est mémorisé dans le navigateur.
Dans l'Annuaire, **Liste** est le mode par défaut lors d'une première visite.

L'Annuaire possède maintenant une présentation dédiée :

- recherche instantanée sur le nom, le prénom et le second prénom ;
- filtres par nom, lieu, année de naissance, année de décès et branche ;
- tris A → Z, Z → A, du plus ancien au plus récent et inversement ;
- dates compactes avec les symboles `✦` et `†`, et `—` pour une date absente ;
- vue Liste compacte et vue Cartes responsive utilisant les mêmes informations ;
- photo ou avatar de 52 px, second prénom dans la typographie secondaire déjà
  utilisée dans l'arbre ;
- accès direct aux documents associés, sans ouvrir d'abord la fiche Personne ;
- ouverture de la fiche par la ligne ou par la flèche discrète à droite.

Le lieu reste présent dans la fiche et dans les filtres mais n'occupe plus une
zone permanente dans les lignes. Sur tablette, les cartes passent à deux
colonnes. Sur mobile, les deux modes utilisent une mini-fiche sur une colonne
avec des actions tactiles d'au moins 44 px.

## Fondations du Design System

Le fichier `css/design-system.css` centralise les couleurs sémantiques,
typographies, espacements, rayons, ombres, tailles de contrôle et états
interactifs communs. Il complète les styles historiques sans modifier la
logique de l'application. Le détail de l'audit et des conventions appliquées
est disponible dans `DESIGN_SYSTEM.md`.

## Modales et formulaires

Les fenêtres utilisent désormais les formats Small, Medium et Large du Design
System. Leur en-tête, leur éventuelle navigation et leurs actions restent
stables ; seule la zone centrale défile lorsque le contenu dépasse la hauteur
disponible. La fiche Personne conserve ainsi la même largeur et la même hauteur
pendant le passage entre Identité, Liens familiaux et Documents associés.

Les formulaires longs sont segmentés par catégories légères, sans multiplier
les cartes. Les champs conditionnels des dates et des fins de relation restent
affichés uniquement lorsqu'ils sont pertinents. Les erreurs de saisie sont
présentées près du champ concerné et la saisie déjà effectuée est conservée.

## Langage d’interaction

Les retours de succès, d’information et d’erreur utilisent désormais le même
composant. Les boutons signalent les opérations en cours et bloquent les doubles
soumissions. Suppression définitive et dissociation sont visuellement et
textuellement distinguées ; les confirmations sont réservées aux actions ayant
une conséquence importante.

Les menus, états vides, cartes et icônes suivent les mêmes conventions dans
l’Arbre, l’Annuaire, les Documents, les Tâches et l’administration. Les détails
de cette couche sont documentés dans `INTERACTIONS.md`.

## Responsive et accessibilité

La mise en page s’adapte progressivement au desktop large, au desktop étroit,
à la tablette, au smartphone et au petit smartphone. Sur mobile, les modales
importantes deviennent de véritables écrans, les filtres restent dans le
viewport, les formulaires et listes passent à une colonne et les cibles
tactiles conservent une hauteur minimale de 44 px.

Les champs utilisent les claviers mobiles adaptés. Le menu du compte et les
onglets Paramètres sont navigables au clavier, le focus est toujours visible et
les animations respectent `prefers-reduced-motion`. Les détails techniques et
les limites de validation sont disponibles dans
`RESPONSIVE_ACCESSIBILITY.md` et `RESPONSIVE_QA_REPORT.md`.

La passe finale de protection fonctionnelle et la revue écran par écran sont
consignées dans `FINAL_QA_REPORT.md`.

## Personnes et arbre

La fenêtre de création et de modification d'une personne contient désormais
trois sections dans une fiche unique : **Identité**, **Liens familiaux** et
**Documents associés**. Identité s'ouvre toujours par défaut. Lors de la
création, les deux autres sections restent consultables avec une indication
demandant d'enregistrer d'abord l'identité ; après ce premier enregistrement,
la fiche passe directement aux liens familiaux sans ouvrir une autre fenêtre.
Le passage d'une section à l'autre ne réinitialise pas les champs saisis.

Dans Documents associés, les documents peuvent être consultés ou modifiés et
un nouveau document peut être rattaché à la personne. Le champ **Titre** est
facultatif. Quand il est vide, l'application affiche automatiquement, sans
renommer le fichier, le premier libellé disponible parmi : type de document,
nom du fichier, puis « Document ».

- Le champ `lastName` correspond au **nom de naissance** et reste le nom affiché
  sur les cartes de l'arbre, même lorsqu'un nom d'usage est renseigné.
- Les fiches acceptent aussi un second prénom, un nom d'usage, un lieu de
  naissance ainsi qu'une date et un lieu de décès.
- Sur les cartes de l'arbre, le second prénom utilise une typographie distincte.
  Seuls les prénoms, le nom de naissance et les dates/lieux complets de naissance
  et de décès sont affichés. Le champ Nom d'usage est toujours proposé et reste
  enregistré dans la propriété historique `marriedName` pour préserver les données.
- Les libellés Naissance et Décès sont remplacés par les symboles généalogiques
  `✦` et `†`. Une donnée absente apparaît simplement sous la forme `—`.
- La photo d'une personne se sélectionne depuis l'appareil. Elle est recadrée au
  centre, convertie en WebP ou JPEG et compressée automatiquement afin que la
  donnée enregistrée ne dépasse pas 5 Ko. Les anciennes URL restent compatibles.
- **Retirer de l'arbre** met `inTree` à `false` : la fiche, ses documents et ses
  liens sont conservés dans l'annuaire.
- **Supprimer définitivement** depuis l'annuaire supprime la fiche et nettoie
  ses références dans les familles, documents et tâches.
- Une fiche masquée possède un bouton **Ajouter à l'arbre**.

L'annuaire est toujours classé par nom de naissance, puis par prénom. La barre
alphabétique permet d'atteindre directement la première fiche correspondant à
une lettre.

Les lignes de chaque foyer utilisent une couleur distincte. Le trait épais
relie les partenaires ; les traits plus fins et les points de jonction relient
le foyer à ses enfants, afin de mieux distinguer les branches.

Le menu **Créer un lien** permet de choisir manuellement un enfant et un ou
deux parents. Les listes de personnes sont triées par nom de naissance, puis par
prénom. L'axe vertical est calculé automatiquement : toutes les personnes
d'une même génération restent alignées. Le déplacement manuel d'une carte agit
donc uniquement sur son axe horizontal.

Les positions déplacées manuellement sont mémorisées dans le navigateur. Le
bouton **Réorganiser** restaure à tout moment le placement généalogique
automatique.

## Dates généalogiques et relations enrichies

Les dates de naissance et de décès peuvent être saisies comme date précise,
année seule, année approximative, période entre deux années ou date inconnue.
La même saisie est disponible pour le début et la fin d'une union. La précision
est conservée dans `birthDateInfo`, `deathDateInfo`, `unionDateInfo` et
`endDateInfo` ; aucune année seule n'est transformée en faux 1er janvier.

Dans **Personne → Liens familiaux → Détails**, chaque foyer peut enregistrer :

- le type de relation (mariage, PACS/union civile, union libre, autre ou non
  précisé), sa date et son lieu ;
- une séparation, un divorce ou une autre fin de relation, avec date et lieu ;
- la filiation biologique, adoptive, incertaine ou non précisée pour chaque
  lien parent → enfant.

Une séparation ou un divorce ne supprime jamais les partenaires. Dans l'arbre,
les unions terminées et les filiations adoptives ou incertaines utilisent des
traits discontinus discrets ; les cartes restent volontairement simples.

Les anciennes fiches contenant uniquement `birthDate`/`deathDate` et les
anciens foyers contenant uniquement `partnerIds`/`childIds` restent lisibles.
Ils reçoivent des valeurs neutres à l'affichage, sans migration ni réécriture
automatique. Les sauvegardes V3 conservent les nouveaux champs et la restauration
continue d'accepter les anciennes archives.

## Sauvegarde et restauration

Le bouton **Sauvegarder** crée une archive ZIP complète contenant les personnes,
les foyers, les documents, les fichiers associés et les tâches. Le bouton
**Restaurer** fusionne une telle archive avec les données présentes : un élément
portant le même identifiant est mis à jour, les autres éléments existants sont
conservés. L'archive est contrôlée avant import ; une auto-parenté, une boucle,
un foyer invalide ou une référence manquante bloque la restauration.

Les comptes Firebase Authentication, mots de passe et droits d'accès ne sont
pas inclus dans l'archive : ils restent gérés séparément par Firebase et le menu
Administration.

La création et la lecture du ZIP chargent ponctuellement JSZip depuis le CDN
jsDelivr. Le fonctionnement quotidien de l'arbre ne dépend pas de ce chargement.

## Intégrité et accès

- La recherche ignore les accents dans l'arbre, l'annuaire, les documents et les
  tâches.
- Les couleurs des foyers restent stables lorsque l'arbre est réorganisé.
- L'application refuse les doublons probables et les liens familiaux circulaires.
- Les nouvelles règles Firebase contrôlent le nombre de parents, les doublons
  dans un foyer, la taille des photos et la taille des blocs de fichiers.

Seuls les comptes au statut **Actif** peuvent consulter et modifier les données
généalogiques. Les comptes En attente, Suspendus ou Refusés ne peuvent pas lire
l'arbre ni ses documents. Les rôles servent à réserver la gestion des accès aux
administrateurs ; les membres actifs conservent les fonctions collaboratives
d'ajout et de modification de l'arbre.

Les profils et les droits d'accès sont très légers et restent dans Firestore :
aucun service payant, Cloud Function ou Firebase Storage n'est ajouté. Cette
évolution reste donc compatible avec l'offre gratuite Firebase Spark.
