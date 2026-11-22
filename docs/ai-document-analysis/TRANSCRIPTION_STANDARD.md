# Standard de transcription diplomatique

## 1. Finalité et couches textuelles

Le texte diplomatique décrit ce qui est lisible dans le document, avec ses formes historiques. Il n’est ni une édition modernisée ni une traduction. Trois couches peuvent coexister, chacune versionnée séparément :

1. **Diplomatique** : graphies, abréviations, ponctuation, casse, langue et disposition lisibles ; incertitudes/lacunes marquées.
2. **Normalisée** (facultative) : aide de recherche ou expansion explicitement éditoriale, liée à la forme diplomatique. Ne jamais remplacer le texte source ni cacher la graphie historique.
3. **Traduction française** (facultative) : traduction de segments identifiés, liée à la version diplomatique exacte. Elle ne corrige pas la source.

Pour les protocoles décrits ici, `[…]` est une notation éditoriale et ne doit pas être confondue avec les crochets littéralement présents dans l’original. Le texte source reste transcrit au plus près ; les marqueurs et notes sont stockés séparément lorsqu’un format structuré le permet.

## 2. Identité et ordre

- Attribuer une page et une zone/colonne avant ou pendant la lecture ; garder leur identifiant stable dans cette version.
- Numéroter les lignes dans l’ordre réel de lecture, à partir de `1` par zone logique. Employer un libellé explicite tel que `c1-l01`, `c2-l01` si deux colonnes se lisent séparément.
- Les numéros n’affirment pas que l’original porte ces lignes : ils sont éditoriaux.
- Tables et registres : enregistrer d’abord en-têtes, colonnes et lignes ; conserver les cellules vides comme telles. Ne pas réordonner en prose si cela perd la correspondance cellule/colonne.
- Pagination : chaque page possède sa propre séquence ; indiquer une continuité (`suite de la ligne …`) dans les métadonnées/notes et ne jamais fusionner les images ou les IDs des pages.

## 3. Conventions proposées

Les conventions sont des choix de transcription du projet à valider sur l’échantillon d’annotation avant le pilote ; le texte original n’est jamais altéré par un changement de convention.

| Cas | Convention diplomatique proposée | Métadonnée requise |
|---|---|---|
| Texte lisible | Reproduire accents, lettres, ponctuation et casse tels que vus ; ne pas corriger une faute de scribe | aucune |
| Abréviation | Conserver l’abréviation observée ; ne pas développer en silence | note de développement possible dans couche normalisée, avec source/éditeur |
| Expansion | Si elle aide, signaler les lettres développées par l’éditeur, par ex. `Gio[vanni]`, seulement si convention approuvée | `editorialExpansion=true`, lecture originale et expansion distinguées |
| Lecture incertaine | Conserver une lecture principale prudente et une ou plusieurs alternatives structurées ; aucune alternative ne disparaît | `hypotheses[]`, confiance qualitative, justification et ancre |
| Mot partiellement illisible | Conserver les caractères sûrs et marquer le segment manquant, p. ex. `Gio[illisible]ni` ; ne pas deviner selon le contexte | étendue des caractères connus et zone |
| Mot entièrement illisible | Marqueur de projet `[illisible]` ; ne pas produire de remplacement plausible | `unreadable=true`, ancre, raison/qualité facultative |
| Lacune matérielle | `[lacuna]` pour perte matérielle attestée, distincte d’une encre illisible | type `physical-loss` et ancre |
| Ajout interlinéaire | Transcrire à sa position de lecture avec indication `[ajout interlineaire]` ; ne pas l’insérer comme texte initial | auteur si connu (scribe/autre), position et ancre |
| Correction du scribe | Garder la première forme lisible et la correction ; noter texte barré/ajout et ordre éditorial | `scribeCorrection`, formes et ancre |
| Texte barré | Transcrire la forme barrée si lisible, notée `[barré: …]`; si illisible, indiquer `[barré, illisible]` | statut barré séparé du contenu |
| Marge | Marquer `[marge, haut]`, `[marge, gauche]`, etc. ; garder comme zone distincte et ne pas l’insérer dans le corps | région, position, relation à la ligne si établie |
| Ponctuation absente/ambiguë | Ne pas ajouter de ponctuation moderne comme si elle était source ; commentaire séparé au besoin | note éditoriale |
| Changement de langue | Garder la langue originale (italien, latin, autre) et changer l’étiquette au segment ; pas de traduction dans le champ diplomatique | `language` par région/segment, incertitude si inconnue |
| Nom propre | Reproduire la forme lue ; variantes identifiées séparément ; aucune normalisation généalogique implicite | assertion/forme normalisée distincte |

Ces marqueurs textuels donnent une lecture humaine rapide ; la donnée structurée (hypothèses, ancre, type de lacune, provenance) fait foi pour les traitements et le benchmark. Un marqueur n’autorise jamais l’invention du texte manquant.

## 4. Segmentation et alignement

Un segment correspond à une ligne ou unité de lecture cohérente, et conserve : identifiant de segment, ordre, texte, libellé de ligne, langue, zone cible, ancre normalisée, passages illisibles, hypothèses et auteur/version de transcription. Une ancre se rapporte à l’empreinte et à la page exactes du média. Si l’alignement ne peut être déterminé, conserver `anchor: null` et marquer la révision pour revue ; ne pas dessiner une boîte approximative sous prétexte de complétude.

Les passages courts peuvent grouper plusieurs mots, mais une assertion extraite doit encore permettre de retrouver un segment et sa citation exacte. Pour tables, conserver la grille logique (ligne/colonne/cellule) en plus de l’ordre linéaire éventuel.

## 5. Traduction

- Traduire chaque segment à partir d’une version diplomatique identifiée ; garder le lien `passageId`/version source.
- Respecter le sens administratif, notarial, religieux ou juridique de l’époque ; si une équivalence française moderne est utile, la placer en note, pas à la place d’une traduction littérale nécessaire.
- Préserver noms, unités, titres et dates historiques ; ne convertir les unités que dans une note qualifiée.
- Pour le latin ou une lecture incertaine, garder la source et marquer la traduction `needs-review`; une traduction probable ne rehausse pas la confiance de transcription.
- Une correction substantielle de l’italien entraîne la revue de la traduction correspondante. Une correction du français ne modifie pas l’italien.

Le modèle actuel distingue déjà `textIt`, `translationFr`, `translationState`, `hypotheses`, `unreadable`, `separatorAfter`, `lineLabel` et `anchor` (`document-transcription.js`). Cette proposition enrichit les règles éditoriales ; elle ne demande pas une migration ni n’affirme que tous les marqueurs ci-dessus existent dans le modèle actuel.

## 6. Continuité et variantes

Une lecture interpage peut signaler continuité de phrase, répétition d’en-tête ou identité candidate ; chaque ligne demeure néanmoins liée à sa page et sa zone. Un nom vu ailleurs est une aide contextuelle, jamais une preuve suffisante pour compléter une graphie illisible. Conserver des variantes orthographiques comme observations distinctes, puis éventuellement une proposition de rapprochement révisable.

## 7. Correction et publication

Corrections diplomatiques, normalisations et traductions ont des champs et versions séparés. Toute modification manuelle garde la valeur antérieure, la personne qui corrige, l’horodatage, la cible, le motif si disponible, et les résultats IA à l’origine de la suggestion. Accepter une transcription ne valide pas automatiquement ses traductions ni les personnes/extractions. La publication officielle dans l’application demeure sous validation humaine explicite et utilise ses révisions immuables existantes.
