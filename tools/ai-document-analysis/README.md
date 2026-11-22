# Prototype local — transcription historique

Prototype Windows expérimental, indépendant de La Nostra Storia, Firebase et du navigateur. Il conserve les images à leur emplacement d’origine, journalise localement les propositions et références, et calcule CER/WER quand une référence humaine existe. **Aucun moteur IA n’est actuellement actif** : Florence-2-base a été abandonné après évaluation utilisateur.

> `fixture-text` est le seul moteur sélectionnable : c’est une fixture déterministe qui enregistre le texte saisi par l’opérateur et **ne lit pas l’image**. Elle sert à vérifier le pipeline, l’interface, la traçabilité et les métriques. Elle ne produit pas une transcription et ne doit jamais être présentée comme une lecture de manuscrit. Les propositions déjà produites par Florence-2 restent consultables dans SQLite, marquées `florence-2-base`, sans pouvoir être rejouées.

## Architecture

```text
Tkinter + Pillow (interface desktop locale)
     ├─ sélection/validation d’images JPEG/PNG → documents.py (chemin + SHA-256)
     ├─ contrat TranscriptionEngine → registre available_engines() (engines.py)
     ├─ runner.py → validation de l’empreinte avant exécution
     ├─ storage.py → SQLite local (documents, exécutions, propositions, références, évaluations)
     └─ evaluation.py → CER/WER avec normalisation NFC + espaces uniquement
```

Le registre `available_engines()` est le point d’extension : il ne contient aujourd’hui que `fixture-text`, et accueillera un futur moteur HTR sans toucher à l’interface, au runner ni au stockage.

Les références humaines sont append-only, numérotées par révision ; une nouvelle correction ne remplace pas les anciennes. Original, proposition et référence restent des enregistrements distincts. Les échecs et exécutions restées `running` au redémarrage sont conservés (`failed`/`interrupted`). Le prototype n’établit aucune connexion réseau.

## Prérequis Windows

- Windows 10/11 et Python 3.11, 3.12 ou 3.13 (64 bits) avec Tkinter. Avec l’installation utilisateur Python.org 3.13, le chemin par défaut est :

```powershell
$basePython = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
& $basePython --version
```

- Une connexion Internet peut être utilisée pour installer Pillow ; aucune image n’est envoyée à cette installation ni à un service d’analyse.
- Si Python est installé à un autre emplacement, affecter à `$basePython` le chemin de son `python.exe` approuvé. Les alias Microsoft Store ne constituent pas un interpréteur installé.

## Créer l’environnement isolé

Depuis PowerShell, à la racine du dépôt :

```powershell
Set-Location "tools/ai-document-analysis"
$basePython = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
& $basePython -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Pillow (`requirements.txt`) est la seule dépendance Python tierce nécessaire : interface, fixture et tests tournent dans `.venv`.

## Rejets locaux de Florence-2 (conservés, non exécutés)

Florence-2-base a été retiré du code et des dépendances du dépôt après évaluation utilisateur. Les artefacts déjà présents sur ce PC restent **en place** et sont toujours ignorés par Git. Leur suppression est volontairement laissée à l’opérateur.

| Élément | Emplacement | Taille relevée |
|---|---|---|
| Venv dédié Florence | `tools/ai-document-analysis/.venv-florence/` | 840 Mio (29 533 fichiers) |
| Poids du checkpoint | `tools/ai-document-analysis/model-cache/` | 444 Mio (10 fichiers) |
| Venv actif du prototype | `tools/ai-document-analysis/.venv/` | 26 Mio (1 118 fichiers) — **à conserver** |

Le venv Florence contenait Python 3.13.17, Torch 2.14.1+cpu, torchvision 0.29.1+cpu, Transformers 4.46.3, Accelerate 1.16.0, timm 1.0.31, einops 0.8.2, Pillow 12.3.0 et psutil 7.2.2. Le cache contenait le snapshot `microsoft/Florence-2-base` révision `5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`.

Commandes de nettoyage **proposées, jamais exécutées par le projet** — à lancer manuellement depuis `tools/ai-document-analysis` si l’opérateur décide de récupérer ≈1,25 Go :

```powershell
# À décider et exécuter manuellement ; aucune commande automatique n’est branchée.
Remove-Item -LiteralPath .\.venv-florence -Recurse -Force
Remove-Item -LiteralPath .\model-cache -Recurse -Force
```

Ne pas supprimer `.venv` : il porte l’interface, la fixture et les tests. Supprimer `.venv-florence` et `model-cache` n’affecte ni SQLite, ni les documents référencés, ni les propositions historiques.

## Démarrer l’interface locale

```powershell
.\.venv\Scripts\python.exe .\run.py
```

Dans l’interface :

1. **Référencer des images…** ouvre un sélecteur JPEG/PNG. Les fichiers ne sont pas copiés ni modifiés ; SQLite conserve leur chemin, SHA-256, format et dimensions. Le chemin est relu à chaque ouverture/exécution.
2. Sélectionner un document, faire défiler l’image et utiliser `+ Zoom` / `− Zoom` ou Ctrl+molette.
3. La liste **Moteur** ne propose aujourd’hui que `fixture-text` : choisir un texte, lancer, et l’enregistrement se fait dans un worker pour garder l’interface réactive. Cette fonction ne transcrit pas les pixels.
4. Sélectionner les propositions dans la liste — y compris les propositions historiques `florence-2-base` — pour les comparer visuellement à la référence et voir CER/WER s’ils sont calculables.
5. Corriger le champ de référence puis **Enregistrer nouvelle référence humaine**. Le nom/ID de la personne qui relit et une confirmation explicite sont requis ; une nouvelle révision est ajoutée, jamais écrite à la place de la précédente.

Ne jamais enregistrer comme référence humaine un texte que personne n’a vérifié sur l’image.

## Commandes CLI

Le même programme accepte ces commandes depuis le répertoire du prototype :

```powershell
.\.venv\Scripts\python.exe .\run.py import "C:\Archives\Registro è\pagina 1.jpg"
.\.venv\Scripts\python.exe .\run.py list
.\.venv\Scripts\python.exe .\run.py run-fixture "sha256:<empreinte affichée par list>" --text "texte d’essai saisi"
.\.venv\Scripts\python.exe .\run.py reference "sha256:<empreinte>" --reviewer "initiales" --text "transcription relue"
.\.venv\Scripts\python.exe .\run.py evaluate "sha256:<empreinte>"
.\.venv\Scripts\python.exe .\run.py summary
```

`--text` doit être fourni explicitement pour l’adaptateur de fixture. Les arguments CLI peuvent être conservés dans l’historique du terminal ; pour des transcriptions privées, préférer l’interface ou un fichier protégé, et ne pas employer une machine partagée.

La commande `run-florence` a été retirée : `run.py run-florence …` est désormais refusé par argparse (code 2). Les exécutions Florence passées restent lisibles via `list`, `evaluate` et `summary`.

## Données locales et configuration

Par défaut, SQLite est dans `tools/ai-document-analysis/.local-data/prototype.sqlite3`. Le dossier est ignoré par Git. Les lignes de documents contiennent un **chemin local** et une empreinte, pas le média. Sauvegarder/réconcilier les images et la base selon les règles locales de protection des archives. Les résultats privés ne sont pas inclus dans Git.

La variable d’environnement `DOCUMENT_ANALYSIS_DATA_DIR` permet de placer les données hors du dépôt, par exemple :

```powershell
$env:DOCUMENT_ANALYSIS_DATA_DIR = "D:\Archives-privees\benchmark"
.\.venv\Scripts\python.exe .\run.py
```

Pour personnaliser la limite de taille locale ou `data_dir`, copier `config.example.json` vers `config.json` (fichier ignoré par Git) puis l’éditer. `external_calls_enabled` doit rester `false` ; le prototype refuse une configuration qui l’active. La variable d’environnement du répertoire de données, si renseignée, remplace `data_dir`.

La configuration documente un budget de travail futur de 3 EUR/mois et l’interdiction d’appels externes. La fixture locale a un coût connu de 0 EUR ; cela ne représente ni prix ni coût d’un moteur réel. Un coût futur inconnu devra rester inconnu. Aucun plafond de facturation n’est implémenté car aucun service payant n’est branché.

## Mesures et conventions

- CER : distance de Levenshtein caractère / nombre de caractères de référence.
- WER : distance de Levenshtein mot (découpage par espaces) / nombre de mots de référence.
- La seule normalisation est Unicode NFC et réduction des suites d’espaces. Accents, ponctuation, graphies, casse et abréviations ne sont pas supprimés ni corrigés.
- Sans référence, état `reference-missing`; référence vide, état `reference-empty`; dans les deux cas CER/WER sont indisponibles, pas zéro. Une proposition vide contre une référence non vide produit un score calculable de 1.0.
- Les évaluations sont liées à l’ID exact de la révision humaine ; une correction ultérieure conduit à une évaluation distincte.

Pas de seuil de réussite et aucun résultat de performance revendiqué. Le résumé CLI donne le nombre de documents, exécutions, révisions de référence et évaluations calculables.

## Tester

Depuis ce dossier :

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

Les fixtures sont générées en mémoire/répertoire temporaire (images synthétiques sans donnée d’archive). Les tests ne configurent ni réseau ni Firebase, ne chargent aucun modèle et n’utilisent que `.venv`.

## Ajouter un moteur ultérieur

Tout moteur futur implémente le contrat `TranscriptionEngine` (`document_analysis/contracts.py`) et s’enregistre dans `available_engines()` (`document_analysis/engines.py`). L’interface Tkinter, la CLI, le runner et SQLite n’ont pas besoin d’être modifiés : le registre pilote la liste **Moteur**, et la configuration est vide par défaut (seule `fixture-text` demande un texte à l’opérateur).

Un adaptateur doit retourner un `EngineResult` complet (texte, référence de modèle, durée, coût ou `None` + `cost_status`, confiance, provenance structurée) sans jamais écraser les propositions ni les références humaines existantes. La durée de chargement `model_load_ms` reste dans le contrat et dans SQLite : elle est conservée pour les exécutions Florence historiques.

Avant d’ajouter un moteur : examiner licence, taille du modèle, matériel, provenance, confidentialité, tarifs et possibilité hors ligne. Ne pas mettre de clé dans Git ou le client, ne pas activer automatiquement une API et ne pas faire de seconde lecture « indépendante » avec la même sortie. Évaluer tout moteur selon le [protocole du lot 9](../../docs/ai-document-analysis/EVALUATION_PROTOCOL.md).

**Prochaine piste retenue : un moteur HTR spécialisé en écritures italiennes anciennes**, et non un modèle de vision généraliste. Aucun téléchargement ni installation d’un autre moteur n’est engagé pour l’instant.

## Limites actuelles

- **Aucun moteur IA réel n’est actif** : seul `fixture-text` (non-IA) est sélectionnable ; il ne lit pas les pixels.
- Florence-2-base a été abandonné après évaluation utilisateur : transcription largement incohérente sur une lettre manuscrite italienne, inférence CPU d’environ 97 secondes, forte pression sur la RAM et difficultés de chargement d’une nouvelle image.
- Pas de moteur HTR entraîné spécifiquement pour l’italien historique ; c’est la prochaine piste à évaluer.
- Pas de PDF, multipage, segmentation de lignes/colonnes, ancres, variantes de lecture ou édition structurée diplomatique dans le prototype actuel.
- La correction humaine est un texte diplomatique brut versionné ; le champ note est disponible dans la base, mais pas encore exposé à l’interface.
- L’interface est desktop locale Tkinter, non une page web et non l’atelier de La Nostra Storia.
- Le registre SQLite n’est ni une base officielle ni synchronisé avec Firestore ; aucune donnée généalogique n’y est intégrée.
- Les références de fichiers pointent sur l’emplacement original. Si le fichier est déplacé ou changé, il faut le sélectionner/importer à nouveau ; si son contenu a changé, l’exécution est bloquée par la comparaison SHA-256.

### Évaluation moteur IA — lot 11

L’évaluation comparative, le test synthétique et les mesures Florence sont archivés dans [`ENGINE_EVALUATION_11.md`](../../docs/ai-document-analysis/ENGINE_EVALUATION_11.md), qui porte désormais la mention d’abandon. Les propositions Florence déjà enregistrées restent dans SQLite avec leur provenance d’origine. Transkribus `Italian Administrative Hands, 1550–1700` (`htrId=48299`) demeure le candidat HTR le plus spécialisé, mais son API exige un plan Scholar (99 €/an), un compte et un DPA avant toute donnée personnelle : il n’est pas branché. Les images familiales restent locales.
