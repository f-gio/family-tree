# Lot 11 — évaluation préalable des moteurs de transcription

**État après autorisation utilisateur :** le checkpoint Florence-2-base de Microsoft/Hugging Face est présent dans le cache local, sa révision et son empreinte sont vérifiées, et il est intégré au prototype comme OCR local CPU expérimental. Une inférence réelle a été exécutée hors ligne sur une image synthétique ; aucun compte, API, service cloud, archive familiale ou coût de service n’a été utilisé. Le candidat HTR Transkribus reste non activé.

## 1. PC local — constat vérifié

Diagnostic Windows local, sans changement des paramètres système :

| Élément | Résultat |
|---|---|
| Windows | Windows 11 Famille, 64 bits, build `10.0.26300` |
| CPU | Intel Core i5-10210U, 4 cœurs / 8 threads, x64 |
| RAM visible | 8 212 980 KiB (≈ 7,83 Gio) ; environ 642 Mio libres lors du relevé — valeur instantanée |
| GPU | NVIDIA GeForce MX250, 2 Gio VRAM ; pilote 461.40, runtime CUDA indiqué 11.2 |
| GPU intégré | Intel UHD Graphics, mémoire partagée annoncée par Windows |
| Disque C: | 495 343 104 000 octets, dont 82 769 305 600 libres au relevé (≈ 77,1 Gio) |
| Python prototype | 3.13.17 x64 ; venv et Tkinter 8.6 ; Pillow 12.3.0 |
| Python de base (`.venv`) | Pillow 12.3.0 ; pas de paquet ML |
| Venv dédié `.venv-florence` | Python 3.13.17 x64, Torch 2.14.1+cpu, torchvision 0.29.1+cpu, Transformers 4.46.3, Accelerate 1.16.0, timm 1.0.31, einops 0.8.2, Pillow 12.3.0, psutil 7.2.2 ; versions complètes dans `requirements-florence.lock.txt` |

L’installation Python a été faite en mode utilisateur au lot précédent. Le PATH utilisateur contient le répertoire Python mais la session PowerShell héritée ne l’avait pas rechargé ; les commandes du prototype emploient le chemin explicite. Aucun pilote, CUDA, WSL ou autre composant système n’a été installé ici.

## 2. Moteurs considérés

| Candidat | Aptitude/documentation vérifiée | Compatibilité, coût, confidentialité | Décision |
|---|---|---|---|
| **Transkribus, interface Web gratuite** | La formule Free annonce 50 crédits mensuels et la reconnaissance de texte ; l’interface du modèle `48299` propose un essai de fichier. Le tarif courant du service indique 1 crédit par page pour la reconnaissance de texte. | Compte externe requis ; le fichier image est téléversé chez READ-COOP. Ce n’est pas une API gratuite et le test manuel ne branche pas le prototype. Ne pas transmettre de données personnelles avant DPA ; ne pas transmettre d’archive sans autorisation distincte. | Option la moins coûteuse pour un essai manuel utilisateur sur image synthétique/non personnelle, après son autorisation. Pas l’option d’intégration automatique. |
| **Transkribus, API + Italian Administrative Hands (`htrId=48299`)** | Le catalogue READ-COOP décrit un modèle PyLaia manuscrit italien, 1550–1700, fondé sur des écritures administratives provenant notamment d’archives d’État de Milan, Venise, Florence, Pise et Gênes. Métadonnées publiées : 315 pages d’entraînement, 33 de validation ; CER de validation annoncé 12,2 %. Le jeu est marqué `UndisclosedDataSet`, non accessible/réutilisable. Cela le rend prometteur comme premier candidat pour le thème, sans établir sa qualité sur le corpus familial. | Le service API exige Scholar ou supérieur. Le tarif officiel Scholar consulté est 99 €/an (900 crédits/an), équivalent affiché 8,25 €/mois ; le tarif dépasse l’hypothèse de 3 €/mois. API : 50 % du tarif de crédits de l’interface, un job texte correspondant normalement à une page. Image JPEG/PNG/TIFF, max 20 Mo et une image/job ; résultat asynchrone avec texte et coordonnées ; le résultat API est annoncé conservé 24 h. Le fichier original est transmis au serveur READ-COOP en Autriche. Le modèle n’est pas fourni comme poids local librement téléchargeables dans le catalogue/API consulté. Création de compte nécessaire. Conditions READ-COOP : les images ne doivent pas contenir de données personnelles sans DPA préalable ; les documents d’archives peuvent en contenir. | **Candidat prioritaire à autoriser**, mais pas activable dans le lot sans accès API, coût et DPA/autorisation de données appropriés. Le CER cité est celui de son propre jeu de validation, pas un résultat du lot 11. |
| Transkribus, Text Titan II (`579509`) | Modèle manuscrit généraliste ; fiche fournisseur indique italien et latin parmi 12 langues/scripts et 250 millions de mots. L’API de catalogue renvoie `finalValidationCer=0.043`, mais `nrOfValidationGtPages=0` et le dataset est non divulgué ; ce CER n’est donc pas interprétable comme une validation indépendante reproductible. La fiche le réserve à Scholar+. | Même service distant, authentification, accès Scholar+ et transfert d’image. La licence est celle du service/conditions READ-COOP ; aucun poids téléchargeable autonome identifié. | À comparer ultérieurement si `48299` ne correspond pas aux mains ou périodes ciblées ; pas le premier modèle choisi, car moins spécifique à l’italien administratif historique. |
| Transkribus, `XX Century Italian Handwriting 2.0` (`649861`) | Fiche modèle : 20e–21e siècle, fonds d’archives de dix figures culturelles conservés à l’Université catholique de Milan ; 841 pages d’entraînement, 94 de validation ; CER final 4,65 %, CER validation 7,34 % dans ses données. La fiche précise que son corpus est surtout académique/littéraire. | Même contraintes du service ; jeu d’entraînement et validation non accessible/réutilisable. | Piste distincte pour archives italiennes manuscrites du 20e siècle, mais pas le modèle initial sans benchmark de style documentaire. Scores catalogue uniquement, non transposables aux archives locales. |
| **Kraken / HTRMoPo / eScriptorium** | Kraken est un ATR historique/multiscript, segmentation et lignes, code Apache-2.0 ; son dépôt renvoie aux modèles HTRMoPo. eScriptorium, interface de transcription intégrée à Kraken, déclare une licence MIT. | Le README courant de Kraken annonce Linux/macOS (Python 3.10–3.13), et `pyproject.toml` classe POSIX. Dépendances comprenant PyTorch/torchvision, SciPy, scikit-learn, scikit-image et autres. eScriptorium documente une stack de service (Django, PostgreSQL, Elasticsearch, Redis, Celery, Docker) et Linux/macOS/Windows via WSL. WSL absent ; modèle libre italien adapté non identifié durant cette recherche. | Non retenus localement : Kraken n’est pas officiellement Windows natif, aucun modèle italien utilisable Windows n’a été confirmé ; eScriptorium dépasse le prototype simple et la contrainte système. Code open source ne signifie pas que tous les poids ont la même licence. |
| **Microsoft Florence-2-base (vision/OCR local)** | Model card Microsoft décrit `<OCR>` et `<OCR_WITH_REGION>` sur une image ; 0,23 milliard de paramètres, poids F16. Pas de benchmark publié consulté sur cursive italienne historique ou sur le corpus familial. | Checkpoint officiel safetensors de 463 221 266 octets (~442 Mio) présent dans le cache et SHA-256 vérifié. L’installation CPU utilise Python 3.13.17 et les versions listées ci-dessus. Le modèle s’exécute en float16 CPU sur ce PC ; GPU non utilisé. Le dépôt complet fait ≈1,94 Go car il contient un checkpoint `.bin` redondant, non téléchargé. Aucun fichier utilisateur ne quitte le PC. La fiche du dépôt indique MIT ; les sources personnalisées de configuration/modèle/processeur portent des en-têtes Apache-2.0. | **Moteur intégré**, preuve de fonctionnement technique sur une image synthétique seulement. Il s’agit d’un OCR multimodal généraliste, pas d’un HTR historique validé. |
| **Tesseract 5 / tessdata italien** | OCR LSTM imprimé, code Apache-2.0 ; le dépôt indique plus de 100 langues. `ita.traineddata` n’est pas un modèle HTR spécialisé. | Binaire Windows tiers/officiel à installer et poids de langue à télécharger ; licences des données entraînées distinctes du moteur. Aucun test ici sur manuscrit ancien. | Exclu comme candidat paléographique ; piste possible seulement pour imprimés/formulaires, pas une solution aux actes cursifs. |
| Microsoft TrOCR `microsoft/trocr-base-handwritten` | Model card Microsoft sous MIT, 333 331 200 paramètres, fine-tuné sur IAM (manuscrits anglais, lignes simples) ; la fiche indique explicitement une reconnaissance d’images de lignes. Le dépôt Hugging Face affiche environ 6,52 Go utilisés au total pour fichiers/versions. | Local évite la transmission après téléchargement, mais poids/dépendances lourds et téléchargement soumis à autorisation ; 333 M paramètres F32 représentent environ 1,33 Go de poids, sans runtime/activations. GPU 2 Gio insuffisant pour une exécution GPU confortable ; RAM libre au relevé ≈642 Mio. Segmentation préalable obligatoire et domaine anglais IAM éloigné des registres italiens anciens. | Écarté comme premier moteur : le modèle disponible n’est pas adapté à l’italien historique ni au layout complet ; modèle lourd sur le PC constaté. |
| Autres VLM/OCR API | Les API peuvent analyser l’image entière et certains retournent zones/texte ; aucune autre offre actuelle n’a été établie ici simultanément comme HTR italien ancien, intégrable sans compte/coût et conforme à la confidentialité. | Aucun endpoint appelé, aucun compte ou token créé ; frais, conservation et traitement varient selon fournisseur. | À comparer seulement après vérification fournisseur et autorisation de transfert/coût. |

### Interprétation des scores affichés par les catalogues

Les CER ci-dessus sont des chiffres réellement publiés par les fiches/catalogues cités, mais les corpus sont différents, certains jeux sont non divulgués, et les conditions d’annotation/test ne sont pas nécessairement comparables. **Aucun de ces nombres n’est une mesure sur les documents de l’utilisateur.** La fiche `Italian Administrative Hands` fournit validation 12,2 % (33 pages), pas un résultat indépendant/scellé. Florence a produit une transcription sur une image imprimée synthétique, mais aucun CER/WER n’est calculable faute de référence humaine et ce résultat ne démontre rien sur la cursive historique.

## 3. Décision moteur et options

Le moteur local effectivement branché est **Florence-2-base**, l’unique exécution qui respecte localité des images et budget nul après autorisation du checkpoint. Sa pertinence paléographique reste à établir. Le candidat spécialisé le plus proche du corpus demeure **Transkribus Italian Administrative Hands 1550–1700 (`htrId=48299`)** : la fiche documente notamment des fonds de Milan et un usage partiel du latin, mais il reste une piste externe à autoriser, pas un moteur de cette intégration.

Conclusions demandées :

A. **Meilleure option locale gratuite :** Florence-2-base, maintenant installé et réellement exécutable sur CPU. Son checkpoint modèle est MIT, avec sources personnalisées sous en-têtes Apache-2.0. Le fonctionnement OCR est démontré sur texte imprimé synthétique uniquement ; il n’est pas prouvé qu’il lise correctement les cursives anciennes. Le PC lit la génération CPU, mais la lenteur mesurée rend le traitement en lot coûteux en temps.

B. **Meilleure option gratuite externe :** essai manuel Transkribus Free (50 crédits/mois affichés, reconnaissance texte à 1 crédit/page). Il faut un compte et l’image est transférée au fournisseur ; ce n’est pas l’API utilisable par le prototype. Utilisation uniquement sur une image non personnelle, librement utilisable, après autorisation expresse.

C. **Option la plus spécialisée pour l’archive ancienne italienne :** Transkribus `Italian Administrative Hands 1550–1700` (`48299`), mais inférence via service/compte, sans poids local publiés identifiés, API Scholar payante, transfert d’image et condition DPA pour données personnelles. Modèle à tester sur un petit échantillon licite avant toute conclusion de qualité.

**Pour la première intégration qui reste strictement locale et gratuite, Florence-2-base est le seul moteur retenu dans ce lot.** Ce choix permet le test technique sans service externe, pas une affirmation qu’il est le meilleur paléographe. Pour une reconnaissance véritablement spécialisée, `48299` reste à évaluer ultérieurement sous autorisation/coûts/DPA distincts.

Il n’y a pas d’intégration API Transkribus ni d’essai de transcription externe. L’accès programmatique est réservé au plan Scholar ou supérieur, affiché à **99 €/an**, au-dessus du budget de travail de 3 €/mois. Le plan Free (50 crédits/mois) permet l’usage du site mais pas l’API ; il ne satisfait donc pas le besoin d’un moteur directement branché au prototype.

Le fournisseur indique que les jobs API utilisent l’image transmise, acceptent une seule image par requête (max. 20 Mo), produisent texte/lignes/coordonnées, et conservent les résultats 24 h. La page de confidentialité READ-COOP précise aussi une exigence de DPA avant transfert de données personnelles et l’interdiction de documents contenant des données personnelles sans cet accord. La politique générale et le flux API ont des formulations de rétention différentes ; il faut obtenir une confirmation/DPA écrite avant d’envoyer une archive personnelle. Aucun document n’a été transmis pour l’évaluation.

### Vérification reproductible du moteur local et conditions pour la suite

**Florence-2-base en local :** le checkpoint safetensors de **463 221 266 octets (~442 Mio)** est présent dans le cache local et son SHA-256 a été vérifié : `03075d2d2d2bbd3e180b9ba0afae4aa8563226e2d32911656966e05b2f2ee060`. Il correspond à la révision `5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac`. Le script explicite `python download_florence_model.py` vérifie les fichiers épinglés et ne les retélécharge pas si le cache est déjà complet.

```powershell
cd tools\ai-document-analysis
.\.venv-florence\Scripts\python.exe download_florence_model.py
.\.venv-florence\Scripts\python.exe -m unittest discover -s tests -v
$env:FLORENCE_RUN_INTEGRATION = "1"
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
.\.venv-florence\Scripts\python.exe -m unittest discover -s tests_integration -v
```

Ces commandes sont exécutées avec le venv dédié `.venv-florence`, sans CUDA ni service externe durant l’inférence. Le jeu de dépendances est figé dans `requirements-florence.lock.txt` ; le dépôt complet vaut environ 1,94 Go parce qu’il contient aussi un checkpoint `.bin` redondant qui n’est pas nécessaire. Le test d’intégration emploie une image synthétique et interdit les sockets. La fiche du dépôt indique MIT ; les sources personnalisées de configuration/modèle/processeur portent des en-têtes Apache-2.0. Le cache du modèle et les venv sont locaux et exclus de Git.

**Résultat réel sur image synthétique imprimée :** texte de référence dessiné : `ATTO DI NASCITA\nGiovanni Bianchi - 1902` ; proposition Florence : `ATTO DI NASCITAGiovanni Bianchi - 1902`. Lors de la dernière exécution d’intégration : chargement 1 407 ms, génération 97 007 ms, transcription totale 97 054 ms. RAM disponible : 1 148,2 Mio avant chargement, 929,0 Mio après chargement, 537,4 Mio après inférence ; RSS du processus : 354,8 Mio puis 818,8 Mio. Mesure ponctuelle, sans CER/WER humain ; la sortie a fusionné les lignes. Le moteur refuse désormais de démarrer si moins de 1 024 Mio de RAM sont disponibles avant le chargement, pour préserver une marge système.

**Suite Transkribus :** l’essai du site ou de l’API reste une décision distincte. Avant transfert, il faut un accord explicite sur le compte/coût et l’image exacte ; pour toute donnée personnelle, obtenir le DPA requis. Aucun identifiant ni transfert externe n’est configuré dans le prototype.

1. Créer manuellement un compte Transkribus via [l’inscription READ-COOP](https://account.readcoop.eu/auth/realms/readcoop/protocol/openid-connect/registrations?client_id=transkribus-webui-app&response_type=code&scope=openid&redirect_uri=https%3A%2F%2Fapp.transkribus.org%2F).
2. Si l’intégration API reste souhaitée, souscrire manuellement le plan Scholar à **99 €/an** sur [la page tarifaire officielle](https://www.transkribus.org/pricing) (900 crédits/an) ; aucun paiement ne sera initié par le prototype ou l’agent.
3. Avant toute image contenant des informations relatives à des personnes, obtenir et signer le DPA requis par READ-COOP. Pour un premier essai sans DPA, fournir une image synthétique ou librement utilisable, sans données personnelles, et autoriser explicitement son transfert au service en Autriche.
4. Après ces étapes seulement, une intégration API nécessiterait une autorisation séparée sur le token et les images nominativement sélectionnées. Les identifiants seraient conservés hors Git, dans les variables d’environnement ou un stockage local protégé. Aucun secret ou original ne sera ajouté au dépôt.

Florence-2-base est le seul moteur réel effectivement intégré ; `fixture-text` demeure disponible comme fixture déterministe non-IA. Le résultat Florence confirme seulement le bon fonctionnement technique sur texte imprimé synthétique. Aucun moteur alternatif purement local suffisamment adapté et officiellement supporté sur ce PC n’a été confirmé.

## 4. Sources officielles consultées (2026-11-22)

- Kraken, README et licence Apache 2.0 : https://github.com/mittagessen/kraken · https://github.com/mittagessen/kraken/blob/main/LICENSE
- Kraken, dépendances et classifiers Python/POSIX : https://github.com/mittagessen/kraken/blob/main/pyproject.toml
- eScriptorium, licence, stack et OS (dont WSL sous Windows) : https://gitlab.com/scripta/escriptorium · https://gitlab.com/scripta/escriptorium/-/raw/develop/README.md
- READ-COOP, modèle Italian Administrative Hands (`48299`) : https://www.transkribus.org/models/italian-administrative-hands-1550-1700 ; métadonnées publiques : https://transkribus.eu/TrpServer/rest/models/text/48299
- READ-COOP, modèle XX Century Italian (`649861`) : https://transkribus.eu/TrpServer/rest/models/text/649861
- READ-COOP, Text Titan II (`579509`) : https://www.transkribus.org/models/text-titan-ii ; https://transkribus.eu/TrpServer/rest/models/text/579509
- READ-COOP, plans et crédits : https://www.transkribus.org/pricing ; accès API, authentification, jobs, modèles, image et coût : https://docs.transkribus.org/start/auth · https://docs.transkribus.org/start/first-job · https://docs.transkribus.org/start/credits · https://docs.transkribus.org/processing/images · https://docs.transkribus.org/processing/text-recognition
- READ-COOP, confidentialité et conditions : https://legal.transkribus.org/privacy · https://legal.transkribus.org/terms
- Microsoft TrOCR (card, base IAM, licence MIT, paramètres) : https://huggingface.co/microsoft/trocr-base-handwritten ; métadonnées de dépôt : https://huggingface.co/api/models/microsoft/trocr-base-handwritten
- Microsoft Florence-2-base (model card, tâches OCR et licence MIT) : https://huggingface.co/microsoft/Florence-2-base ; métadonnées officielles, taille exacte des fichiers : https://huggingface.co/api/models/microsoft/Florence-2-base?blobs=true
- Tesseract OCR, dépôt officiel : https://github.com/tesseract-ocr/tesseract
