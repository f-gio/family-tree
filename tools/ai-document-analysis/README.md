# Prototype local — transcription historique

Prototype Windows expérimental, indépendant de La Nostra Storia, Firebase et du navigateur. Il conserve les images à leur emplacement d’origine, journalise localement les propositions et références, et calcule CER/WER quand une référence humaine existe.

> **Limite essentielle : aucun moteur de reconnaissance IA/HTR n’est connecté.** Le seul moteur inclus, `fixture-text`, est déterministe : il enregistre le texte que l’opérateur lui fournit et ne lit pas l’image. Il sert à vérifier le pipeline, l’interface, la traçabilité et les métriques. Il ne produit pas une transcription et ne doit jamais être présenté comme une lecture de manuscrit.

## Architecture

```text
Tkinter + Pillow (interface desktop locale)
     ├─ sélection/validation d’images JPEG/PNG → documents.py (chemin + SHA-256)
     ├─ contrat TranscriptionEngine → FixtureTextEngine (fixture non-IA seulement)
     ├─ runner.py → validation de l’empreinte avant exécution
     ├─ storage.py → SQLite local (documents, exécutions, propositions, références, évaluations)
     └─ evaluation.py → CER/WER avec normalisation NFC + espaces uniquement
```

Les références humaines sont append-only, numérotées par révision ; une nouvelle correction ne remplace pas les anciennes. Original, proposition et référence restent des enregistrements distincts. Les échecs et exécutions restées `running` au redémarrage sont conservés (`failed`/`interrupted`). Les appels réseau ne font pas partie du prototype.

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

La seule dépendance Python tierce est Pillow (`requirements.txt`), utilisée pour valider et afficher les images JPEG/PNG. SQLite, Tkinter (fourni par l’installation Python Windows), hashage, CLI et tests utilisent la bibliothèque standard.

## Démarrer l’interface locale

```powershell
.\.venv\Scripts\python.exe .\run.py
```

Dans l’interface :

1. **Référencer des images…** ouvre un sélecteur JPEG/PNG. Les fichiers ne sont pas copiés ni modifiés ; SQLite conserve leur chemin, SHA-256, format et dimensions. Le chemin est relu à chaque ouverture/exécution.
2. Sélectionner un document, faire défiler l’image et utiliser `+ Zoom` / `− Zoom` ou Ctrl+molette.
3. **Adapter fixture (non-IA)** demande un texte saisi par l’opérateur et l’enregistre comme proposition d’essai ; cette fonction ne transcrit pas les pixels.
4. Sélectionner les propositions dans la liste pour les comparer visuellement à la référence et voir CER/WER s’ils sont calculables.
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

## Connecter ultérieurement un vrai moteur

Implémenter `TranscriptionEngine` dans `document_analysis/contracts.py` et l’enregistrer dans `available_engines()` (`engines.py`). L’adaptateur reçoit chemin/image locale, configuration, instructions et `run_id` ; il retourne `EngineResult` avec texte, ID/version, durée, coût (montant ou `None` accompagné de `cost_status`), erreurs, confiance qualitative et provenance/configuration. Épingler et hasher les instructions et paramètres ; garder `unknown` si la confiance ou le coût n’est pas fourni par un instrument réel.

Avant ajout : examiner licence, taille du modèle, matériel, provenance, traitement des images, confidentialité, tarifs et possibilité hors ligne. Ne pas mettre de clé dans Git ou le client, ne pas activer automatiquement une API, ne pas télécharger de modèle lourd et ne pas faire de seconde lecture « indépendante » avec la même sortie. Tout premier moteur réel doit être évalué selon le [protocole du lot 9](../../docs/ai-document-analysis/EVALUATION_PROTOCOL.md) ; aucun moteur réel n’a été implémenté ici.

## Limites actuelles

- Pas de transcription IA/HTR réelle, de modèle, de connexion API, d’OCR, de traduction ou d’extraction.
- Pas de PDF, multipage, segmentation de lignes/colonnes, ancres, variantes de lecture ou édition structurée diplomatique dans le prototype actuel.
- La correction humaine est un texte diplomatique brut versionné ; le champ note est disponible dans la base, mais pas encore exposé à l’interface.
- L’interface est desktop locale Tkinter, non une page web et non l’atelier de La Nostra Storia.
- Le registre SQLite n’est ni une base officielle ni synchronisé avec Firestore ; aucune donnée généalogique n’y est intégrée.
- Les références de fichiers pointent sur l’emplacement original. Si le fichier est déplacé ou changé, il faut le sélectionner/importer à nouveau ; si son contenu a changé, l’exécution est bloquée par la comparaison SHA-256.

### Évaluation moteur IA — lot 11

Une comparaison documentaire locale est consignée dans [`ENGINE_EVALUATION_11.md`](../../docs/ai-document-analysis/ENGINE_EVALUATION_11.md). Elle recommande Transkribus `Italian Administrative Hands, 1550–1700` (`htrId=48299`) pour l’adéquation paléographique, mais son API exige un plan Scholar (99 €/an), un compte et un DPA avant traitement de données personnelles. Florence-2-base est le meilleur candidat local gratuit à évaluer, mais son poids (≈442 Mio) et ses dépendances n’ont pas été installés, et sa qualité sur ces écritures n’est pas établie. Aucun modèle n’a été téléchargé, aucune archive transmise ; `fixture-text` reste le seul moteur réellement disponible et n’effectue aucune reconnaissance.
