# Architecture de l’analyse documentaire historique

**Statut :** proposition d’architecture pour le prototype. Les décisions dites « retenues pour le prototype » sont des choix de départ réversibles, pas des engagements de fournisseur ni des performances validées. Aucun composant de cette proposition n’est développé au lot 9.

## 1. Objectifs et principes

Le système doit aider à lire des photographies d’archives, non décider à la place du chercheur. Le corpus visé est inférieur à 1 000 photographies, majoritairement manuscrites et italiennes (Lombardie, province de Varèse), mais comprend aussi latin, tableaux, documents administratifs, annotations et documents multipages.

Ordre de priorité : fidélité au document matériel, localisation de chaque assertion, incertitude explicite, vérification sur l’image, validation humaine, puis facilité d’automatisation. Une information produite automatiquement est toujours une **proposition**. Elle n’est jamais une donnée généalogique officielle.

Principes structurants :

1. L’original photographique/PDF et son empreinte restent immuables ; les traitements référencent l’original et ne le remplacent pas.
2. Transcription diplomatique, texte éventuellement normalisé, traduction, extraction et hypothèse historique sont des objets distincts.
3. Toute proposition doit remonter à une page et à une zone, ou indiquer explicitement qu’elle n’a pas d’alignement précis.
4. La confiance est une étiquette qualitative (`high` = confiance élevée, `medium`, `low`, `unknown`), jamais une probabilité calibrée. L’incertitude textuelle et la demande de revue restent également explicites.
5. Les étapes sont déterministes et reprenables ; les modèles ne se coordonnent pas librement entre eux.
6. Pas d’envoi à un service externe sans décision ultérieure explicite, analyse de confidentialité et consentement approprié.

## 2. Architecture logique

```text
Photographie/PDF original (lecture seule, SHA-256)
            │
            ▼
Orchestrateur déterministe ── registre local des exécutions (SQLite, prototype)
  ├─ A. archiviste : classe, langue, structure et zones
  ├─ B. paléographe : transcription diplomatique alignée
  ├─ C. vérificateur : compare image, transcription et éventuelle lecture indépendante
  ├─ D. traducteur : français aligné sur les segments italiens/latins
  ├─ E. extracteur : assertions structurées ancrées aux segments
  └─ F. analyste généalogique : rapprochements/hypothèses, sans écriture métier
            │
            ▼
Propositions versionnées + incertitudes + provenance
            │
            ▼
Revue humaine, corrections et décision explicite
            │
            ▼
Passage manuel dans les mécanismes existants de La Nostra Storia
```

Un « agent » désigne ici un **rôle avec une entrée, une sortie et une consigne versionnée**, pas nécessairement un modèle autonome. L’orchestrateur invoque des tâches isolées et valide leurs contrats. Il ne laisse pas les rôles s’appeler entre eux, inventer des tâches ou modifier les données d’entrée.

### Choix de spécialisation

| Option | Atouts | Limites | Décision de prototype |
|---|---|---|---|
| Un modèle partagé, consignes par rôle | Simple à installer, coût et provenance faciles à comparer | Les rôles ne sont pas des avis indépendants ; contexte et biais communs | Baseline minimale, chaque rôle reste une exécution séparée et tracée |
| Plusieurs moteurs spécialisés | Peut exploiter un HTR dédié et comparer des approches différentes | Plus de formats, intégration, coût, licences et maintenance | À évaluer sur le corpus ; pas de dépendance obligatoire |
| Hybride : orchestrateur simple, adaptateurs de moteurs | Étapes et contrats indépendants des fournisseurs ; remplace un moteur sans changer le modèle métier | Nécessite de maintenir un petit adaptateur par capacité | **Cible privilégiée** si le premier benchmark démontre l’intérêt de plusieurs moteurs |

Pour mesurer l’indépendance, une deuxième lecture n’est dite indépendante que si elle provient d’une exécution distincte, dont les entrées ne contiennent pas la transcription de la première, et dont le moteur/modèle ou la méthode diffère de façon documentée. Deux consignes appliquées au même résultat ne constituent pas deux confirmations.

### Familles de moteurs à comparer

| Famille | Usage candidat | Vérification nécessaire |
|---|---|---|
| Modèle multimodal généraliste | Compréhension d’ensemble, classification, lecture d’image, vérification visuelle | Fidélité aux lignes italiennes anciennes, stabilité des coordonnées, hallucinations et politique de conservation des images |
| HTR spécialisé | Reconnaissance ligne à ligne et manuscrits ; pistes de recherche à vérifier : Kraken/eScriptorium, Transkribus | Couverture des mains/périodes/langues lombardes, entraînement/licence, export d’alignements, traitement local ou distant et tarifs actuels |
| OCR spécialisé imprimé | Actes imprimés, formulaires et textes dactylographiés | Ne pas le présenter comme solution manuscrite ; mesurer tableaux, caractères accentués et documents dégradés |

Ces noms sont des **pistes de benchmark**, pas des dépendances choisies, recommandations garanties, services souscrits ni preuve de compatibilité/qualité. Vérifier versions, conditions et disponibilité avant tout essai ; aucun fichier n’est transmis dans le lot 9.

## 3. Orchestrateur et états

Prototype : programme Python local, pipeline explicite et registre SQLite local. Un état est enregistré par exécution et par tâche/page, pas uniquement dans la mémoire du processus.

États de tâche : `pending` → `running` → `succeeded`, `needs_review`, `failed` ou `cancelled`. `blocked` indique une dépendance indisponible. Toute transition conserve l’horodatage et le motif. `needs_review` est un résultat exploitable, pas une erreur.

États de l’exécution : `created`, `running`, `paused`, `completed`, `completed_with_review`, `failed`, `cancelled`. L’exécution globale peut être complète même si certains passages restent illisibles ou à valider.

Ordre initial :

1. Enregistrer le document/page, calculer ou vérifier l’empreinte, vérifier le type et les dimensions ; rejeter ou demander correction si une précondition échoue.
2. A décrit type, période si lisible, langues, structure et zones ; la classification demeure révisable.
3. B transcrit chaque zone/page. C compare indépendamment le résultat à l’image. Si un résultat C est contesté, une seconde lecture indépendante peut être demandée comme tâche facultative.
4. Après correction/acceptation de la transcription, D traduit les seuls segments sélectionnés, en conservant l’alignement et les incertitudes.
5. E extrait des assertions des passages choisis. Chaque assertion renvoie aux segments justificatifs. F peut examiner ces assertions et un contexte généalogique **minimisé et explicitement fourni** ; ses sorties sont des hypothèses.
6. L’humain examine, corrige, accepte, rejette ou diffère. Seules les propositions expressément validées peuvent être reprises dans les flux métier actuels.

Étapes facultatives : deuxième lecture indépendante, normalisation de graphie, extraction E, analyse F, traduction D (par exemple texte latin gardé sans traduction). Dépendances : D dépend d’une transcription identifiée ; E dépend d’un texte source identifié ; F dépend d’assertions ou de contexte fourni. Une correction de transcription invalide les descendants qui en dépendent (traduction, extraction et analyse), sans effacer leurs sorties précédentes : les nouvelles sont des versions successeures. Une correction de traduction seule ne relance pas B ni E.

Reprise : reprendre une tâche réussie si et seulement si ses empreintes d’entrée, contrat, consigne/configuration et moteur sont identiques. Une reprise forcée crée une nouvelle tentative. Une interruption garde les tâches terminées et marque la tâche en cours comme interrompue/à reprendre ; ne pas supposer qu’un appel distant annulé n’a pas été facturé.

Documents multipages : orchestration page par page, identités stables de page/zone, plus une étape de synthèse explicitement distincte. Le contexte de continuité (noms, dates ou phrases déjà vus) est un contexte de lecture signalé comme tel ; il ne remplace jamais le texte de la page et ne doit pas rendre les pages d’un même document indépendantes dans les ensembles d’évaluation.

## 4. Persistance de prototype

SQLite local garde exécutions, tâches, versions de sorties, empreintes, coûts estimés/réels disponibles et événements humains. Les photographies et sorties sensibles restent dans un répertoire contrôlé par l’utilisateur ; SQLite enregistre des références locales et des empreintes. Base et fichiers doivent être sauvegardés ensemble si l’utilisateur demande une sauvegarde. Une suppression locale n’est autorisée que par une action explicitement prévue, jamais par un nettoyage de rétention implicite.

Cette persistance n’est ni une nouvelle base métier de La Nostra Storia ni une future collection Firestore proposée. À l’intégration web, les documents, brouillons, révisions officielles, preuves, sources et associations existants restent la référence ; le protocole de transport et la persistance des seules propositions doivent faire l’objet d’une décision séparée.

## 5. Options Windows et coût

Python est retenu provisoirement pour le prototype : environnement virtuel isolé, commandes simples, scripts inspectables, traitement de fichiers et SQLite intégrés. Commencer par CLI et fichiers de configuration versionnés. **Ne pas imposer** Docker, NAS, GPU, serveur permanent ni base vectorielle. Streamlit n’est à essayer que si une revue locale visuelle s’avère nécessaire ; il ne doit pas devenir la frontière métier.

Pour l’orchestration, un pipeline Python explicite (états, dépendances, persistance et reprise écrits pour ce faible volume) est préférable au départ à un framework d’agents. Un framework de graphe/orchestration ne sera réévalué que si les reprises, tâches parallèles, observabilité ou exécutions longues deviennent pénibles à gérer ; il n’assure à lui seul ni indépendance des lectures, ni provenance, ni validation humaine. Le prototype reste indépendant de ce choix par contrats de rôles et adaptateurs simples.

Comparer trois modes, sur les mêmes fichiers et critères :

- **Local** : fichiers non transmis, mais exigences matérielles/installation et qualité HTR à mesurer ; modèles et licences à vérifier.
- **API distante** : coût unitaire potentiellement mesurable, mais transfert d’archives, conservation fournisseur, conditions contractuelles, disponibilité et coûts variables à examiner avant toute autorisation.
- **Hybride** : prétraitement/stockage locaux, seuls extraits autorisés transmis ; réduction des données envoyées ne supprime pas le risque de confidentialité.

Le plafond de **3 EUR/mois** est une hypothèse de travail à confirmer, non une garantie. Aucun tarif ni résultat n’est présumé. Avant chaque lot, calculer le nombre d’appels × tarifs observés et ajouter une marge documentée ; afficher estimation, cumul mensuel et plafond configuré. Refuser le lancement payant si tarif inconnu, estimation supérieure au reste du budget, ou autorisation d’envoi absente. Prioriser petits essais locaux/fichiers publics ou consentis ; réutiliser les résultats identiques par empreinte pour éviter des appels répétés. Aucun service n’est souscrit au lot 9.

## 6. Décisions ouvertes

- Quel échantillon initial et quelle provenance légale des images ?
- Quel moteur HTR supporte effectivement les écritures, périodes, langues et formats du corpus, avec quelles conditions de confidentialité/licence ?
- Le budget de travail suffit-il à une comparaison utile ? Seul un test de prix réel, ultérieurement autorisé, répondra.
- Quelles informations personnelles doivent être occultées, et où les images peuvent-elles être traitées ?
- Quel format d’export minimal sera accepté par l’atelier web sans recopier les sources ni fusionner les statuts ?

Ces questions restent ouvertes ; aucune performance, faisabilité de modèle ou autorisation de traitement externe n’est affirmée.

## Références internes

Voir [CONTRATS](AGENT_CONTRACTS.md), [STANDARD](TRANSCRIPTION_STANDARD.md), [ÉVALUATION](EVALUATION_PROTOCOL.md), [INTÉGRATION](INTEGRATION_PLAN.md) et [docs/TECHNICAL_MAP.md](../TECHNICAL_MAP.md).
