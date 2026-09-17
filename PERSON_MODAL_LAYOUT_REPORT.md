# Family Tree — mise en page de la modale Personne

## Changements réalisés

- ajout de la variante générique `modal-xl` à 57,5 rem (920 px) ;
- utilisation de cette variante uniquement par la fiche Personne ;
- ajout du composant générique `compact-photo-uploader` ;
- ajout du composant générique `event-information-group` pour Naissance et Décès ;
- conservation de la grille Identité validée et de tous les champs existants ;
- adaptation mobile à une colonne et maintien des zones tactiles existantes.

Le téléverseur conserve le même champ fichier, la compression à 5 Ko, le
recadrage, le remplacement et la suppression. Son libellé devient automatiquement
« Ajouter une photo » ou « Modifier la photo » selon l’état actuel.

Naissance et Décès utilisent le même balisage et le même composant visuel. Le
sélecteur de format, les valeurs temporelles et le lieu sont regroupés dans une
surface crème légère. Pour une période « Entre », les deux années et le lieu
utilisent trois colonnes lorsque l’espace le permet, puis une colonne sur mobile.
Le lieu reste disponible lorsque la date est inconnue.

## Design System réutilisé

- palette sémantique existante ;
- échelle d’espacements `--space-*` ;
- rayons `--radius-*` ;
- bordures, ombres et focus existants ;
- contrôles `--control-sm`, `--control-touch` ;
- breakpoint mobile existant à 760 px ;
- structure stable header / onglets / contenu scrollable / footer.

## Vérifications exécutées

- neuf suites Node réussies ;
- syntaxe JavaScript contrôlée ;
- règles Firestore et modules hors périmètre comparés à la V20 : inchangés ;
- présence des contrôles historiques, onglets et actions vérifiée ;
- formats exact, année, vers, entre et inconnue couverts par les tests existants ;
- règles responsive 920 px, tablette fluide, 760 px et 560 px contrôlées.

Le navigateur de test disponible ne peut pas ouvrir une adresse locale dans cet
environnement. Le contrôle visuel pixel par pixel sur desktop, tablette et mobile
n’a donc pas pu être exécuté réellement et devra être confirmé après mise en ligne.
