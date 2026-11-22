# Protocole de constitution du corpus et d’évaluation

## 1. But et statut

Évaluer plusieurs moteurs/rôles sur les **mêmes images, règles de référence et critères**, sans annoncer à l’avance un gagnant. Le corpus réel fait moins de 1 000 photographies ; il n’est pas nécessaire de tout annoter. Les chiffres de seuil ci-dessous sont des **seuils initiaux proposés** pour décider si un pilote mérite d’avancer, jamais des résultats mesurés ni des seuils déjà validés.

## 2. Échantillon

Commencer par 100–150 pages/images candidates provenant d’au moins 30 documents distincts, puis ajuster après inventaire et charge d’annotation. Inclure actes de naissance/mariage/décès, registres militaires, notariaux/cadastraux, recensements, religieux, administratifs et correspondances ; varier dates/périodes, communes, mains, formulaires, italien/latin/mélange, colonnes/tableaux, marge, nombre de pages, netteté, contraste, inclinaison, dégradation et complétude.

Le nombre est un objectif de planification, pas une exigence de puissance statistique. Documenter les strates disponibles et les absences (par exemple absence de notarial). Échantillonner **par document** : réserver toutes les pages et toutes les variantes d’un registre/document dans un seul split pour éviter la fuite de style, de noms ou de mise en page.

Splits initiaux : 60 % développement (glossaires/consignes), 20 % réglage (choix de pipeline), 20 % test scellé (rapport final). Assigner par groupes de documents, stratifier autant que possible par type/période/qualité, et consigner le seed et la liste d’IDs. Le test scellé ne sert pas à écrire les prompts ; si on le réutilise pour améliorer le système, il devient un split de développement et un nouveau test indépendant est nécessaire.

## 3. Annotation de référence

1. Obtenir autorisation d’usage, documenter provenance et restrictions ; retirer/masquer du benchmark les informations non nécessaires si elles identifient des personnes contemporaines.
2. Deux annotateurs transcrivent indépendamment un sous-ensemble calibré (au moins 20 % du test visé), en aveugle des résultats des moteurs et de l’autre lecture. Le reste est annoté par un premier lecteur et vérifié ligne à ligne par le second.
3. Un adjudicateur résout les désaccords en consultant l’image ; il documente aussi les désaccords insolubles et conserve les lectures alternatives. La référence ne force pas un texte unique lorsque l’image ne permet pas de trancher.
4. Annoter régions/colonnes/lignes, diplomatique, langue, variantes, marqueurs de lacune/ajout/barré, traduction si incluse, assertions structurées, preuves d’ancrage, et difficulté de lecture.
5. Geler version de convention et format, conserver annotateur/adjudication/date, et vérifier un échantillon à l’aveugle avant publication des mesures.

Ne jamais entraîner sur les pages du split test. Les corrections d’usage réel rejoignent le corpus d’apprentissage seulement après autorisation, anonymisation/contrôle d’accès approprié et attribution claire de leur split ; ne jamais les faire migrer automatiquement en exemples de consigne.

## 4. Format de référence

Un manifeste par document : IDs stables, pages, SHA-256 de chaque image, métadonnées connues (type, période approximative, langue) et split. Un fichier d’annotation par page contient régions/ordre, lignes/boîtes, transcriptions diplomatiques, alternatives, langue, marqueurs éditoriaux, labels gold des entités et liens (personnes/événements/relations), traductions si le lot les évalue, et décisions d’adjudication. Stocker noms de personnes sous pseudonymes de benchmark lorsque leur identité réelle n’est pas nécessaire.

Format JSONL ou JSON versionné à choisir au prototype ; ne pas le confondre avec les modèles d’application. Maintenir une version brute, une version adjudication et un manifeste de transformations. Empreinte des fichiers et version de standard rendent chaque score reproductible.

## 5. Mesures

Rapporter par document, strate et agrégat ; présenter médiane et distribution, pas seulement une moyenne. Calculer les intervalles d’incertitude au niveau document (bootstrap par groupe, si l’échantillon le permet), jamais en traitant toutes les lignes d’un document comme observations indépendantes.

### Transcription

- **CER** = distance d’édition caractère / nombre de caractères de référence ; **WER** = distance d’édition mots / nombre de mots de référence.
- Publier deux variantes : score brut et score après normalisation d’évaluation strictement décrite (Unicode NFC, espaces convenus). Les accents, la casse, ponctuation, expansion d’abréviations et marqueurs de lacune doivent être mesurés séparément/clarifiés avant score. Ne jamais supprimer les noms propres ou accents pour embellir le score.
- Comparer variantes alternatives acceptables dans la convention d’adjudication ; ne pas pénaliser un moteur pour une ambiguïté intrinsèque sans rapporter cette ambiguïté.
- Ajouter exactitude des lignes/segments, complétude des passages, faux remplissages de lacunes et erreurs de langue.

### Information historiquement importante

- Exactitude exacte et normalisée suggérée des noms propres, variantes, dates et lieux ; precision/recall/F1 par type et exact match, avec appariement document/page/mention.
- Pour les relations, distinguer mentions explicites, relations établies, hypothèses et négations/ambiguïtés. Une relation plausible mais non présente n’est pas un vrai positif.
- **Hallucinations** : assertions sans support de citation, citations non présentes dans source/transcription, détail ajouté à un texte incertain, personne/donnée prétendue absente ; taux par document et gravité. Une assertion sans preuve de segment est non supportée, même si elle s’avère vraie par ailleurs.
- Qualité d’alignement : IoU (intersection sur union) des régions prédites et référence, précision/rappel des régions, ainsi que proportion des passages/extractions pointant une zone correcte. Rapporter seuils IoU multiples ou courbe, ne pas masquer erreurs de lecture derrière une bonne boîte.

### Vérification humaine, débit et coûts

Mesurer le taux de lignes/passages soumis à revue, taux d’acceptation sans correction, temps humain de correction par page, temps mur (préparation, attente, revue séparés), taux d’échec/reprise, coût facturé observé par image/page/document et coût par lot. Inclure prétraitement et vérification indépendante. Pour moteur local, rapporter matériel et durée ; pour API, date, devise, tarif/consommation constatés et taille transmise. Sans facture/mesure, coût = inconnu, pas estimé comme résultat.

Les labels de confiance (`high` = confiance élevée, `medium`, `low`, `unknown`) sont évalués par leur association empirique aux erreurs, seulement si le volume est suffisant ; ne pas les appeler probabilité calibrée avant calibration séparée.

## 6. Comparaison équitable des moteurs

- Même empreinte d’image, mêmes transformations autorisées et mêmes métadonnées/contextes ; le contexte additionnel est un facteur expérimental distinct.
- Figer version moteur/modèle, consignes, paramètres, date, version de prétraitement et limite de sortie. Garder l’original et évaluer les transformations séparément.
- Comparer d’abord B (paléographe) sans puis avec A (zones/classification), ensuite mesures D/E/F séparées ; ne pas attribuer un gain de pipeline à un seul moteur.
- Un second lecteur est indépendant uniquement s’il ne reçoit pas la première transcription et si origine/version de moteur est différente ou méthode indépendante, consignée.
- Rejouer mêmes paires et comparer par document (delta apparié) ; rapporter toutes les strates et échecs, pas seulement les exemples réussis.

## 7. Seuils de décision proposés (non validés)

Le pilote ne passe au développement d’intégration que si la revue humaine juge les sorties traçables et qu’aucun risque grave n’est masqué. Seuils initiaux à confirmer avec les chercheurs : CER médian ≤ 10 % et WER médian ≤ 25 % sur le sous-ensemble lisible, exact match des dates/noms/lieux extraits comparés aux références gold ≥ 90 %, au moins 95 % des assertions avec citation valide, zéro écriture automatique en données généalogiques, et baisse démontrée du temps de première lecture ou de correction. Ces seuils ne sont pas des promesses : avec ambiguïté, faible échantillon ou mauvaise strate, conclure « données insuffisantes » plutôt que déclarer succès.

Tolérances à préciser : le score moyen seul ne suffit pas ; définir seuils séparés pour chaque type d’acte, latin, tableau et qualité basse lorsque l’effectif est utilisable. Une hallucination généalogique non sourcée ou une corruption de l’original est bloquante, quel que soit le CER.

## 8. Apprentissages et garde contre la fuite

- Niveau 1 : consignes versionnées, glossaires et quelques exemples du split développement, chacun référencé et contrôlé.
- Niveau 2 : recherche lexicale d’exemples déjà validés dans le même domaine ; contexte injecté et IDs d’exemples tracés. Comparer erreurs récurrentes par strate. La recherche d’exemples n’est pas une base vectorielle obligatoire.
- Niveau 3 : adaptation HTR/fine-tuning seulement si droits d’utilisation, quantité et diversité annotées suffisantes, split test indépendant, coût/maintenance raisonnables et gain prouvé sur test scellé. Les corrections humaines n’entraînent jamais automatiquement un modèle.

Le corpus test, ses glossaires, les décisions d’adjudication et les corrections retenues pour développement doivent être séparés par rôle d’accès. Les doublons, variantes recadrées, pages d’un même registre ou répétitions de formulaires doivent être groupés au même split.
