# Prototype local — transcription historique

Prototype Windows expérimental, indépendant de La Nostra Storia, Firebase et du navigateur. Il conserve les images à leur emplacement d’origine, journalise localement les propositions et références, et calcule CER/WER quand une référence humaine existe. Florence-2-base est branché comme moteur OCR **local/CPU expérimental** ; cette intégration ne prouve pas sa qualité paléographique.

> `fixture-text` reste un moteur de test déterministe : il enregistre le texte saisi par l’opérateur et ne lit pas l’image. `florence-2-base` analyse réellement les pixels avec la tâche OCR, mais reste un modèle vision/OCR généraliste, pas un HTR entraîné pour la paléographie italienne. Toute sortie est une proposition non validée ; la confiance reste `unknown`.

## Architecture

```text
Tkinter + Pillow (interface desktop locale)
     ├─ sélection/validation d’images JPEG/PNG → documents.py (chemin + SHA-256)
     ├─ contrat TranscriptionEngine → fixture-text (non-IA) ou florence-2-base (OCR CPU)
     ├─ florence_engine.py → Transformers/Torch CPU, révision et fichiers vérifiés
     ├─ runner.py → validation de l’empreinte avant exécution
     ├─ storage.py → SQLite local (documents, exécutions, propositions, références, évaluations)
     └─ evaluation.py → CER/WER avec normalisation NFC + espaces uniquement
```

Les références humaines sont append-only, numérotées par révision ; une nouvelle correction ne remplace pas les anciennes. Original, proposition et référence restent des enregistrements distincts. Les échecs et exécutions restées `running` au redémarrage sont conservés (`failed`/`interrupted`). L’inférence n’utilise pas le réseau ; seul le script explicite de téléchargement du modèle contacte Hugging Face pour des fichiers publics épinglés, sans envoyer d’image.

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

Pillow (`requirements.txt`) est suffisant pour l’interface et fixture-text. Florence-2 s’exécute dans un **venv dédié** (`.venv-florence`) avec ses versions CPU épinglées dans `requirements-florence.txt` ; l’installation ne touche ni le Python système ni `.venv`.

## Installer Florence-2 (CPU, une seule fois)

Depuis PowerShell, à la racine du dépôt :

```powershell
Set-Location "tools/ai-document-analysis"
$basePython = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
if (!(Test-Path -LiteralPath .venv-florence)) { & $basePython -m venv .venv-florence }
.\.venv-florence\Scripts\python.exe -m pip install -r requirements-florence.txt
.\.venv-florence\Scripts\python.exe .\download_florence_model.py
```

Les wheels PyTorch/torchvision installées sont CPU uniquement (Torch 2.14.1+cpu, torchvision 0.29.1+cpu). Les versions directes sont épinglées dans `requirements-florence.txt` et l’environnement résolu est figé dans `requirements-florence.lock.txt` : Transformers 4.46.3, Accelerate 1.16.0, timm 1.0.31, einops 0.8.2, Pillow 12.3.0 et psutil 7.2.2. Pas de CUDA, pilote, WSL ou Docker.

`download_florence_model.py` télécharge uniquement les fichiers autorisés du dépôt Microsoft épinglé à `5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`, vérifie leurs tailles/SHA-256 et n’est jamais appelé automatiquement par le programme. Le checkpoint safetensors fait 463 221 266 octets ; les fichiers `.bin` redondants ne sont pas téléchargés. Les poids et fichiers de modèle restent dans `model-cache/`, ignoré par Git.

La fiche du modèle indique MIT pour le dépôt/checkpoint ; les fichiers Python personnalisés portent aussi des en-têtes Apache-2.0. Ils ont été inspectés à la révision épinglée avant chargement. Le chemin natif de Transformers 5.24 échouait sur le processeur de ce snapshot ; le venv Florence fixe Transformers 4.46.3, sous lequel le processeur personnalisé a passé le smoke test. Cette version exige `trust_remote_code=True` pour son processeur/modèle personnalisé ; le prototype ne l’autorise que sur ces fichiers locaux épinglés, après vérification des empreintes, avec `local_files_only=True` et mode Transformers/Hub hors ligne. Aucun code ou poids n’est récupéré depuis une révision mouvante à l’inférence.

Le chargement est refusé si moins de 1 024 Mio de RAM physique sont disponibles avant de commencer. Ce seuil est un garde-fou initial pour préserver une marge pour Windows, et non une garantie d’absence d’épuisement de la mémoire : des applications concurrentes ou une page plus complexe peuvent encore épuiser la RAM. Fermer les applications lourdes puis réessayer si le contrôle bloque ; interrompre et relancer si Windows signale une pression mémoire.

## Démarrer l’interface locale

```powershell
.\.venv-florence\Scripts\python.exe .\run.py
```

Dans l’interface :

1. **Référencer des images…** ouvre un sélecteur JPEG/PNG. Les fichiers ne sont pas copiés ni modifiés ; SQLite conserve leur chemin, SHA-256, format et dimensions. Le chemin est relu à chaque ouverture/exécution.
2. Sélectionner un document, faire défiler l’image et utiliser `+ Zoom` / `− Zoom` ou Ctrl+molette.
3. Choisir `florence-2-base` dans la liste **Moteur** puis lancer : le modèle lit les pixels en CPU. Le chargement/inférence se fait dans un worker pour garder l’interface réactive ; l’image reste affichée.
4. `fixture-text` demande un texte saisi par l’opérateur et l’enregistre comme proposition d’essai ; cette fonction ne transcrit pas les pixels.
5. Sélectionner les propositions dans la liste pour les comparer visuellement à la référence et voir CER/WER s’ils sont calculables.
6. Corriger le champ de référence puis **Enregistrer nouvelle référence humaine**. Le nom/ID de la personne qui relit et une confirmation explicite sont requis ; une nouvelle révision est ajoutée, jamais écrite à la place de la précédente.

Ne jamais enregistrer comme référence humaine un texte que personne n’a vérifié sur l’image.

## Commandes CLI

Le même programme accepte ces commandes depuis le répertoire du prototype :

```powershell
.\.venv\Scripts\python.exe .\run.py import "C:\Archives\Registro è\pagina 1.jpg"
.\.venv\Scripts\python.exe .\run.py list
.\.venv\Scripts\python.exe .\run.py run-fixture "sha256:<empreinte affichée par list>" --text "texte d’essai saisi"
.\.venv-florence\Scripts\python.exe .\run.py run-florence "sha256:<empreinte affichée par list>"
.\.venv\Scripts\python.exe .\run.py reference "sha256:<empreinte>" --reviewer "initiales" --text "transcription relue"
.\.venv\Scripts\python.exe .\run.py evaluate "sha256:<empreinte>"
.\.venv\Scripts\python.exe .\run.py summary
```

`--text` doit être fourni explicitement pour l’adaptateur de fixture. Les arguments CLI peuvent être conservés dans l’historique du terminal ; pour des transcriptions privées, préférer l’interface ou un fichier protégé, et ne pas employer une machine partagée.

`run-florence` nécessite `.venv-florence` et le cache modèle déjà vérifié. Il ne télécharge rien et échoue explicitement si le modèle est absent.

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

Les fixtures sont générées en mémoire/répertoire temporaire (images synthétiques sans donnée d’archive). Les tests ne configurent ni réseau ni Firebase.

Les tests unitaires sans modèle utilisent `.venv`. Le test d’inférence réelle est isolé et opt-in (`.venv-florence`, cache vérifié, image synthétique uniquement) :

```powershell
$env:FLORENCE_RUN_INTEGRATION = "1"
\.venv-florence\Scripts\python.exe -m unittest discover -s tests_integration -v
Remove-Item Env:FLORENCE_RUN_INTEGRATION
```

## Adaptateur Florence-2 et remplacement ultérieur

`document_analysis/florence_engine.py` implémente `TranscriptionEngine`, utilise le prompt OCR officiel `<OCR>`, conserve le texte décodé brut dans la provenance et restitue la sortie post-traitée séparément. L’inférence est CPU (`float16`), sans appel web ; le coût de service est 0 EUR (énergie électrique non comptée), confiance `unknown`. Si un autre moteur est ajouté, il doit respecter le même contrat dans `document_analysis/contracts.py`/`engines.py`, sans remplacer les sorties brutes ni les références humaines.

Avant d’ajouter un autre moteur : examiner licence, taille du modèle, matériel, provenance, confidentialité, tarifs et possibilité hors ligne. Ne pas mettre de clé dans Git ou le client, ne pas activer automatiquement une API et ne pas faire de seconde lecture « indépendante » avec la même sortie. Évaluer tout moteur selon le [protocole du lot 9](../../docs/ai-document-analysis/EVALUATION_PROTOCOL.md).

## Limites actuelles

- Aucun moteur HTR entraîné spécifiquement pour l’italien historique n’est intégré ; Florence-2-base est un OCR vision généraliste.
- Le modèle peut traiter une page complète sans détecteur de lignes séparé, mais il peut coller les lignes en sortie et ne fournit pas de confiance calibrée. La sortie brute est conservée pour contrôle.
- Pas de PDF, multipage, segmentation de lignes/colonnes, ancres, variantes de lecture ou édition structurée diplomatique dans le prototype actuel.
- L’OCR sur page peut fusionner des lignes (constaté sur la page synthétique). Ne pas inférer l’ordre des colonnes ou annoter des marges sans contrôle humain.
- La correction humaine est un texte diplomatique brut versionné ; le champ note est disponible dans la base, mais pas encore exposé à l’interface.
- L’interface est desktop locale Tkinter, non une page web et non l’atelier de La Nostra Storia.
- Le registre SQLite n’est ni une base officielle ni synchronisé avec Firestore ; aucune donnée généalogique n’y est intégrée.
- Les références de fichiers pointent sur l’emplacement original. Si le fichier est déplacé ou changé, il faut le sélectionner/importer à nouveau ; si son contenu a changé, l’exécution est bloquée par la comparaison SHA-256.

Le premier essai réel a utilisé une page **synthétique imprimée**, pas un manuscrit historique. Il produit une sortie issue des pixels, mais aucune mesure CER/WER n’est présentée faute de référence humaine ; les CER catalogue d’autres moteurs ne s’appliquent pas à Florence. Les durées et la mémoire mesurées lors du test d’intégration sont reportées dans `docs/ai-document-analysis/ENGINE_EVALUATION_11.md`.

### Évaluation moteur IA — lot 11

La comparaison documentaire et le test réel de Florence sont consignés dans [`ENGINE_EVALUATION_11.md`](../../docs/ai-document-analysis/ENGINE_EVALUATION_11.md). Transkribus `Italian Administrative Hands, 1550–1700` (`htrId=48299`) reste le candidat plus spécialisé, mais son API exige un plan Scholar (99 €/an), un compte et un DPA avant toute donnée personnelle ; il n’est pas branché. Florence-2-base est le moteur OCR local expérimental intégré. Les images familiales restent locales.
