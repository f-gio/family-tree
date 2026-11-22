# Plan d’intégration futur à La Nostra Storia

**Périmètre actuel : conception seulement.** Aucun changement de code, schéma Firestore, règle, service ou UI n’est proposé comme réalisé. Les observations ci-dessous sont vérifiées dans la carte technique et les modules nommés ; toute intégration devra être conçue et validée dans un lot dédié.

## 1. Points d’intégration existants

| Besoin | Point existant vérifié | Frontière à préserver |
|---|---|---|
| Choisir un document | Fiche/liste Documents ; `openStoredDocument` dans `app.js` | Un document peut exister sans `sourceDocument`, preuve ou personne associée |
| Lire l’original | `document-file-storage.js` expose `readChunkedFile`; `source-document-model.js` modélise références/empreintes ; l’atelier sait ouvrir fichiers locaux compatibles | Lecture seule, même empreinte ; ne pas recopier le binaire pour le traiter |
| Pages, photos et repères | `source-document-model.js` (pages/photos, SHA-256, `resourceRef`) ; atelier existant JPEG/PDF et ancres | Respecter page/photo/empreinte ; PDF page 1-based ; garder anciens documents compatibles |
| Transcrire/traduire | Vue `transcriptionWorkshopView`, `transcription-workshop.js`, `document-transcription.js` | Réutiliser l’atelier unique ; résultats automatiques restent brouillons/propositions avant validation humaine |
| Brouillon local et distant | `transcription-draft-storage.js`, `transcription-draft-sync.js` | Local ≠ révision officielle ; conflits explicites, aucune fusion silencieuse, propriétaire authentifié pour l’espace distant |
| Publier une transcription | `transcriptionHeads` / `transcriptionRevisions`, `genealogyStore.reviseOfficial` depuis l’application | Révisions officielles immuables et autorisation existante ; validation explicite, jamais au démarrage ni par l’orchestrateur seul |
| Sources officielles et références | `source-document-model.js`, données de collaboration ; `documentIds` facultatif et associations de sources | Documents réutilisables et liens plusieurs-à-plusieurs ; ne pas créer une source artificielle pour pouvoir lancer l’analyse |
| Preuve généalogique | `genealogy-proofs.js` exige citation et, pour passage cité, document/page/passage/révision précise | Une assertion proposée n’est pas une preuve ; seuls les humains créent/valident la preuve via le flux officiel |
| Données généalogiques | fiches Personne/Famille, faits, relations et conclusions | Aucune écriture IA directe ; liens identitaires restent des propositions ; préserver les champs legacy et identifiants |

Repères de code : `app.js` ouvre l’atelier depuis Documents et Archives (`openTranscriptionWorkshop*`, autour des lignes 8845–9085 à la révision examinée), charge les octets via `readChunkedFile`, valide par dialogue de confirmation (autour de 8416–8515), puis appelle le store officiel. L’implémentation peut évoluer ; reconsulter `docs/TECHNICAL_MAP.md` et le code lors du lot d’intégration.

## 2. Flux de sortie recommandé

```text
Prototype local : original existant ou copie autorisée
  → exécution locale/optionnellement autorisée
  → paquet de propositions versionnées + références/empreintes + rapport de revue
  → import/export explicitement déclenché et validé
Application : document retrouvé par identifiant + empreinte
  → présentation des propositions dans l’atelier existant (décision UX séparée)
  → utilisateur corrige et choisit les segments
  → brouillon existant
  → dialogue de validation humaine existant
  → révision officielle existante ou abandon du brouillon
  → preuves/sources/personnes seulement par opérations métier actuelles
```

Le format d’échange doit être défini plus tard. Au minimum : ID du document existant si disponible, SHA-256 de la version binaire traitée, page ID ou correspondance explicitement non résolue, IDs/source versions des segments, provenance complète, moteur et consigne/configuration, incertitudes, état de validation. Si ID absent, proposer une association après comparaison/validation, jamais par rapprochement silencieux du titre. Si l’empreinte diffère, bloquer l’application des ancres et demander un appariement humain.

Un document déjà uploadé sans lien à une source/preuve reste sélectionnable. Les modèles existants permettent source sans documents et plusieurs IDs de documents ; l’atelier sait aussi préparer une page à partir de document legacy sans recopier son original. Ne pas introduire de collection `aiRuns` ou de nouveau schéma par ce document d’architecture.

## 3. Prototype Windows, web statique et traitements longs

### Prototype local

La CLI Python charge explicitement des fichiers locaux autorisés, crée des exécutions SQLite, conserve les sorties localement, et exporte éventuellement un paquet révisable. Elle n’accède pas au navigateur ou à Firestore. L’utilisateur choisit fichiers et emplacement ; pas de scan automatique du profil Windows.

### Application web hébergée

Firebase Hosting sert une page statique distante : elle ne peut pas supposer qu’un service Windows localhost est joignable. Accès browser→localhost dépend de CORS, mixed content HTTPS→HTTP, certificats, règles navigateur, pare-feu, auth et disponibilité de la machine ; une URL loopback n’est pas un canal produit sûr ou universel. Ne pas contourner ces contraintes par extension, tunnel ou serveur ouvert par défaut.

À l’avenir, choisir explicitement entre import/export manuel du prototype, une passerelle distante sécurisée contrôlée, ou un service de traitement séparé. Chacun exige analyse de menace, authentification, autorisation par utilisateur, protection contre CSRF/SSRF/rejeu, chiffrement, limitation de débit/coût, suppression/rétention documentées et validation des règles du modèle. Une option cloud peut imposer Functions/Storage/infra hors des contraintes Spark actuelles et nécessiter une décision/financement distincts ; rien ici ne présume leur adoption.

### Traitements en arrière-plan

Les traitements d’images et appels externes peuvent durer au-delà d’une session navigateur. Une future exécution asynchrone doit permettre état durable, idempotence, annulation au mieux, reprise par tâche, budget, journaux non secrets et reprise de revue humaine. Ne pas faire tourner un long traitement dans un événement UI, ni considérer une fermeture de page comme arrêt de coût. La technologie d’exécution (poste local, machine ponctuelle, service distant) reste ouverte.

## 4. Sécurité, confidentialité et contrôle d’accès

- L’original et sa SHA-256 sont la référence ; aucune sortie ne l’écrase. Refuser les fichiers inattendus, tailles supérieures à la limite métier, type déclaré incohérent ou chemin local hors périmètre.
- Minimiser contexte généalogique : ne transmettre que les personnes/faits requis par l’analyse, sous IDs temporaires lorsque le nom réel n’est pas nécessaire.
- Données relatives à des personnes réelles : classer localement les restrictions, provenance/licence et éventuelles données de personnes vivantes. Pas d’envoi à un fournisseur sans autorisation distincte de l’utilisateur/propriétaire et validation des conditions de conservation/transfert.
- Les credentials/API keys ne sont jamais dans navigateur statique, dépôt, prompts, sorties ou logs. Un proxy éventuel ne doit pas exposer de secret au client.
- Contrôle d’accès : seuls les utilisateurs déjà authentifiés et autorisés pourraient consulter le document ; une future passerelle ne doit pas faire confiance aux seuls IDs fournis par le navigateur.
- Journaliser accès et opérations nécessaires sans recopier intégralement des données privées dans les logs. Définir export, rétention et suppression explicites, incluant copies temporaires, cache et SQLite.
- Le document d’origine, les métadonnées, les transcriptions/traductions, propositions IA et données officielles ont des statuts séparés. Une erreur de modèle ne crée jamais d’écriture généalogique.

## 5. Étapes d’intégration (future décision)

1. Prototype benchmark local en lecture seule, avec corpus et budgets autorisés ; aucune connexion Firebase.
2. Évaluer qualité, provenance, coût et utilité humaine ; arrêter si seuils/risques du protocole ne sont pas satisfaits.
3. Définir paquet d’échange export/import et mapping des IDs/ancres vers documents/pages existants ; tests sur données synthétiques et émulateurs seulement.
4. Prototyper une présentation dans l’atelier **existant**, sans second atelier, sans validation groupée implicite ni écriture automatique.
5. Revue sécurité, règles/architecture backend, coûts et conformité ; approbation explicite avant service externe ou changement de schéma.
6. Déployer en recette seulement dans un lot autorisé ; tester chaque parcours, puis décision distincte pour toute production.

Chaque étape peut s’arrêter sans empêcher Documents, atelier, transcription manuelle et généalogie de fonctionner normalement.
