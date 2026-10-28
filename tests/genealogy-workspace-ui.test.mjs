import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, css, imageViewer] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8"),
  readFile(new URL("../js/document-image-viewer.js", import.meta.url), "utf8")
]);

test("la navigation Archives conserve les identifiants internes et les vues privées", () => {
  assert.match(html, /data-view="genealogy"/);
  assert.match(html, /id="genealogyView"/);
  assert.match(app, /\$\("genealogyView"\)\.hidden = view !== "genealogy"/);
  assert.match(app, /if \(view === "genealogy"\) renderGenealogyWorkspace\(\)/);
});

test("les collections du lot 6 sont abonnées avec des requêtes limitées pour propositions et notifications", () => {
  for (const name of ["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyEvents"]) {
    assert.ok(app.includes(`"${name}"`), `nom de collection abonné absent : ${name}`);
  }
  assert.match(app, /onSnapshot\(target, snapshot/);
  assert.match(app, /if \(collectionName === "genealogyProposals" && !isAdminUser\(\)\) target = query\(target, where\("authorUid", "==", auth\.currentUser\?\.uid/);
  assert.match(app, /if \(collectionName === "genealogyNotifications"\) target = query\(target, where\("recipientUid", "==", auth\.currentUser\?\.uid/);
  assert.match(app, /genealogyCollectionsLoaded\.add\(collectionName\)/);
  assert.match(app, /genealogyCollectionErrors\.delete\(collectionName\)/);
  assert.match(app, /genealogyCollectionErrors\.set\(collectionName, describeFirestoreReadError\(error\)\)/);
  assert.match(app, /genealogyLoaded = genealogyCollectionsLoaded\.size === genealogyCollections\.length/);
});

test("les documents historiques ont une fiche lisible sans métadonnées JSON, Consulter conservé", () => {
  assert.match(app, /legacyDocumentCardDetails\(data, \(data\.personIds \|\| \[\]\)\.map\(personId => person\(personId\)\)/);
  assert.match(app, /const title = legacyDetails \? legacyDetails\.title : genealogyItemTitle\(item\)/);
  assert.match(app, /Photographie disponible/);
  assert.match(app, /const entryContent = legacyDetails[\s\S]*?legacyNotes\}\$\{legacyPhotograph\}/);
  assert.match(app, /tileContextMenuMarkup\("archive-entry", record\.id, title, controls\)/);
  assert.match(app, /action === "open"\) return openGenealogyItem\(item\.kind, id\)/);
  assert.match(app, /if \(kind === "legacy-source"[\s\S]*?openStoredDocument\(item\.record, "archives"\)/);
  assert.match(css, /\.genealogy-entry-legacy-document/);
});
test("les tuiles Sources et Preuves sont cliquables et leur menu est simplifié", () => {
  assert.match(app, /data-primary-tile data-genealogy-tile-kind=/, "tuile Archives cliquable avec identifiant de navigation");
  assert.match(app, /if \(!tile \|\| event\.target\.closest\("button, a, input, select, textarea, summary, \.tile-context-actions"\)\) return/, "le menu … n'ouvre pas la tuile derrière");
  assert.match(app, /\$\("genealogyResults"\)\.addEventListener\("keydown"/, "navigation clavier sur la tuile");
  assert.match(app, /controls\.push\(\{ key: "delete-official", label: "Supprimer définitivement", icon: "trash", danger: true \}\)/, "suppression définitive dans le menu tuile");
  assert.match(app, /if \(item\.kind === "legacy-source"\) controls\.push\(\{ key: "open", label: "Consulter", icon: "eye" \}\)/, "Consulter réservé aux documents historiques");
  assert.match(app, /genealogy-status-badge--\$\{item\.kind\}/, "badge de type coloré selon le kind de la tuile");
  assert.match(app, /genealogy-status-badge--\$\{kind\}/, "badge de type coloré dans les fiches et la visionneuse");
  assert.match(app, /function requestOfficialDeletion\(kind, id, title\)/, "suppression partagée réutilisée");
  assert.match(app, /genealogyItemMenuBtn/, "menu … de la fiche");
  assert.doesNotMatch(app, /function officialDeleteActionsMarkup/, "encadré de suppression retiré des fiches");
  assert.match(app, /renderGenealogyItemActions\(kind, data\)/, "actions de la fiche peuplées à l'ouverture");
  assert.match(app, /activeGenealogyItem\?\.record\?\.id === targetId \|\| activeGenealogyItem\?\.id === targetId/, "fermeture robuste de la fiche après suppression");
});
test("les fiches harmonisent en-tête, libellés et pile de retour", () => {
  const itemHeadStart = html.indexOf('id="genealogyItemDialog"');
  const itemHead = html.slice(itemHeadStart, html.indexOf('</dialog>', itemHeadStart));
  assert.ok(itemHead.includes('class="modal-head-actions"'), "boutons de la fiche regroupés dans la zone droite de l'en-tête");
  assert.ok(
    itemHead.indexOf('id="genealogyItemBackBtn"') > -1
    && itemHead.indexOf('id="genealogyItemBackBtn"') < itemHead.indexOf('id="genealogyItemMenuBtn"')
    && itemHead.indexOf('id="genealogyItemMenuBtn"') < itemHead.indexOf('data-close="genealogyItemDialog"'),
    "ordre en-tête : retour, puis …, puis fermeture ×"
  );
  assert.match(app, /activeGenealogyItem = null;\r?\n  const backButton/, "l'état actif est réinitialisé à la fermeture de la fiche");
  assert.match(app, /activeGenealogyItem = null;\r?\n  \$\("genealogyItemBackBtn"\)\.hidden = true;/, "Sources liées ne conserve aucun item actif hérité");
  assert.doesNotMatch(app, /const subtitleText = \[genealogyKindLabels\[kind\]/, "le type n'est plus répété sous le badge dans le sous-titre");
  assert.match(app, /data-unified-source-card=/, "carte Source ouvrant directement la fiche");
  assert.match(app, /data-unified-proof-card=/, "carte Preuve ouvrant directement la fiche");
  assert.match(css, /--color-source: #46627a/, "couleur dédiée bleu ardoise pour Source");
  assert.match(css, /--color-proof: #6b4470/, "couleur dédiée prune pour Preuve");
  assert.match(css, /\.document-unified-source-head strong \{[^}]*font-size: var\(--text-md\)/, "titre de carte sous le titre de section");
  assert.match(css, /\.document-unified-source--clickable:focus-visible/, "focus visible sur les cartes cliquables");
  assert.doesNotMatch(css, /\.document-unified-source--clickable:hover \{ background/, "aucun fond blanc au survol des cartes");
  assert.match(css, /\.document-unified-source--clickable:hover strong \{ text-decoration: underline/, "titre souligné au survol");
  assert.match(css, /\.document-unified-source--clickable:hover \.document-unified-source-chevron[^}]*font-weight: var\(--weight-semibold\)/, "chevron renforcé au survol");
  assert.match(app, /\$\("viewerDocumentDetails"\)\.addEventListener\("keydown"/, "navigation clavier des cartes du volet");
});

test("propositions, décisions, révisions et réexamens passent par le magasin sécurisé du lot 6", () => {
  for (const operation of ["createProposal", "submitProposal", "cancelDraft", "decideProposal", "createOfficial", "reviseOfficial", "createReexaminationEvent", "markNotificationRead"]) {
    assert.ok(app.includes(`genealogyStore.${operation}(`), `opération du magasin absente : ${operation}`);
  }
  assert.match(app, /hidden = !isAdminUser\(\)/);
  assert.match(app, /key: "proposal-accept", label: "Accepter"/);
  assert.match(app, /key: "review-proof", label: "Demander réexamen"/);
});

test("les boutons contribution et officiel ouvrent les modes attendus, avec garde administrateur", () => {
  assert.match(app, /\$\("genealogyProposeBtn"\)\.onclick = \(\) => openGenealogyContribution\(\)/);
  assert.match(app, /\$\("genealogyOfficialBtn"\)\.onclick = \(\) => openGenealogyContribution\(\{ official: true \}\)/);
  assert.match(app, /const officialMode = Boolean\(official \|\| reviseItem\)/);
  assert.match(app, /if \(officialMode && !isAdminUser\(\)\) return toast\("La création des données officielles est réservée aux administrateurs\."/);
  assert.match(app, /\$\("genealogyOfficialBtn"\)\.hidden = !isAdminUser\(\)/);
  assert.match(app, /openGenealogyContribution\(\{ official: true, reviseItem: item \}\)/);
});

test("le formulaire source officiel est guidé et réutilisable depuis Documents", () => {
  for (const id of ["genealogyOfficialSourceFields", "genealogySourceTitle", "genealogySourceCategory", "genealogySourceDateType", "genealogySourcePlace", "genealogySourceHoldingOrganization", "genealogySourceFondsSeries", "genealogySourceCote", "genealogySourceSubCote", "genealogySourceArchivalReferences", "genealogySourceLanguages", "genealogySourcePersonOptions", "genealogySourceDescription", "genealogySourceResearchNotes", "genealogySourceHypotheses"]) {
    assert.match(app, new RegExp(id), `champ guidé absent : ${id}`);
  }
  for (const label of ["Identification", "Provenance archivistique", "Éléments associés", "Observations"]) assert.match(app, new RegExp(label));
  assert.match(app, /function sourceGuidedPayload\(title\)/);
  assert.match(app, /mergeSourceDocumentGuidedData\(original/);
  assert.match(app, /const payload = official && type === "source" \? sourceGuidedPayload/);
  assert.match(app, /if \(guidedFields\) guidedFields\.hidden = !guidedSource/);
  assert.match(app, /\$\("genealogyContributionPayload"\)\.value = ""/);
  assert.doesNotMatch(app.match(/function sourceGuidedPayload[\s\S]*?\n\}/)?.[0] || "", /JSON\.stringify/);
});

test("Documents propose une source sans duplication et consulte les sources liées", () => {
  assert.match(app, /key: "create-source", label: "Ajouter une source"/);
  assert.match(app, /key: "manage-sources", label: "Gérer les sources liées"/);
  assert.doesNotMatch(app, /data-document-source-revise/);
  assert.match(app, /function openOfficialSourceFromDocument\(documentId\)/);
  assert.match(app, /if \(linkedSources\.length\) return toast\("Une source officielle référence déjà ce document/);
  assert.match(app, /openGenealogyContribution\(\{ official: true, sourceDocument: documentItem \}\)/);
  assert.match(app, /data-open-document-source/);
  assert.match(app, /action === "create-source"/);
});

test("le sélecteur de personnes réutilise le composant partagé et reste distinct des documents associés", () => {
  for (const id of ["genealogySourcePersonSearch", "genealogySourcePersonOptions", "genealogySourcePersonSelection"]) {
    assert.match(app, new RegExp(id), `sélecteur personne absent : ${id}`);
  }
  assert.match(app, /genealogySourcePersonPicker = createPersonMultiSelect\(\{/, "instance du composant partagé");
  assert.match(app, /kind: "genealogy-source"/, "attributs de sélection dédiés");
  assert.match(app, /minQueryLength: DOSSIER_MIN_QUERY_LENGTH/, "longueur minimale identique aux formulaires Documents/Démarches");
  assert.match(app, /personPickerMatches\(query, selectedIds, \(\) => people\.slice\(\)\.sort\(comparePeopleBySurname\)\)/, "moteur de recherche partagé");
  assert.match(app, /const \[label, context\] = personSuggestionLabel\(item\)/, "nom, années et branche comme modèle document");
  assert.match(app, /nameFor: nameOf/, "libellé de pastille partagé");
  assert.match(app, /emptyMessage: PERSON_PICKER_EMPTY_MESSAGE/, "état sans résultat commun");
  assert.match(app, /onChange: ids => \{\r?\n\s+selectedGenealogySourcePersonIds = new Set\(ids\)/, "sélection propagée au formulaire");
  assert.match(app, /class="person-multiselect-results" id="genealogySourcePersonOptions"/, "liste de résultats partagée");
  assert.match(app, /class="person-multiselect-chips" id="genealogySourcePersonSelection"/, "pastilles de sélection partagées");
  assert.match(app, /<h5>Documents associés<\/h5>/);
});

test("la modale source est élargie seulement sur desktop et la liste Documents reste compacte", () => {
  assert.match(css, /@media \(min-width: 761px\)[\s\S]*?#genealogyContributionDialog \{ width: min\(68rem/);
  assert.match(css, /#documentsList\.list-mode \.content-card \{[\s\S]*?grid-template-areas: "main meta people source actions"/);
  assert.match(css, /#documentsList\.list-mode \.document-card-details/);
  assert.match(css, /\.document-source-associations \{[\s\S]*?flex-wrap: wrap/);
  assert.match(app, /const linkedSourcesMarkup = linkedSources\.length/);
  assert.doesNotMatch(app, /data-document-source-revise/);
});

test("les documents ont leur type après le titre, une liaison réelle et un menu secondaire", () => {
  assert.match(app, /<div class="document-card-main"><h3 title=/);
  assert.match(app, /<span class="badge">\$\{esc\(item\.type \|\| "Autre"\)\}<\/span>/);
  assert.match(app, /Date inconnue/);
  assert.match(app, /documentLinkedSources\(item\.id\)/);
  assert.match(app, /linkedSources\.length === 1 \? "Source officielle" : `\$\{linkedSources\.length\} sources liées`/);
  assert.match(app, /class="document-source-associations is-unlinked"/);
  assert.match(app, /key: "create-source", label: "Ajouter une source"/);
  assert.match(app, /key: "manage-sources", label: "Gérer les sources liées"/);
  assert.match(app, /const sourceAction = sourceDocumentsLoaded && isAdminUser\(\)/);
  assert.doesNotMatch(app, /Créer une source à partir de ce document/);
  assert.doesNotMatch(app, /document-card-details[\s\S]{0,260}list-optional/);
});

test("les Archives remplacent le nom visible sans renommer les identifiants internes", () => {
  assert.match(html, /data-view="genealogy"[^>]*aria-label="Archives"[\s\S]*?<span>Archives<\/span>/);
  assert.match(html, /<h2 class="page-title">Archives<\/h2>/);
  assert.match(html, /placeholder="Rechercher dans les archives/);
  assert.match(html, /id="genealogyView"/);
  assert.match(app, /view === "genealogy"\) renderGenealogyWorkspace/);
  assert.match(app, /genealogyCollections = \["sourceDocuments"/);
});

test("une preuve peut être archivée en conservant son historique et sans suppression destructive", () => {
  assert.match(app, /data-genealogy-proof-archive/);
  assert.match(app, /function archiveOfficialProof\(proofId\)/);
  assert.match(app, /if \(!isAdminUser\(\)\) return toast\("L’archivage des preuves est réservé aux administrateurs/);
  assert.match(app, /transitionProofStatus\(proof, \{[\s\S]*?to: "historical"/);
  assert.match(app, /genealogyStore\.reviseOfficial\(\{[\s\S]*?type: "proof"/);
  assert.match(app, /Elle reste accessible dans le filtre Historique/);
  assert.match(app, /kind === "main" && !\([\s\S]*item\.data\.technicalStatus !== "historical"/);
  assert.doesNotMatch(app.match(/function archiveOfficialProof[\s\S]*?\n\}/)?.[0] || "", /deleteDoc|allow delete/);
});

test("la création et la révision source utilisent le store officiel sans écraser les révisions", () => {
  assert.match(app, /genealogyStore\.createOfficial\(\{ type, id: officialId, revisionId, eventId, data: officialData/);
  assert.match(app, /genealogyStore\.reviseOfficial\(\{ type, id: officialId, revisionId, eventId, data: officialData/);
  assert.match(app, /genealogySourceOriginalData = reviseItem\?\.kind === "source" \? structuredClone/);
  assert.match(app, /documentIds: \[\.\.\.selectedGenealogySourceDocumentIds\]/);
  assert.doesNotMatch(app.match(/if \(type === "source"\) \{[\s\S]*?\} else if \(type === "transcription"\)/)?.[0] || "", /writeFileChunks|setDoc\(doc\(db, "documents"/);
});

test("le retrait d'une association passe par une nouvelle révision officielle", () => {
  assert.match(app, /function removeDocumentSourceAssociation\(documentId, sourceId\)/);
  assert.match(app, /function chooseSourceRemovalAction\(\{ canArchive, reason = "" \}\)/);
  assert.match(html, /Retirer uniquement l’association/);
  assert.match(html, /Retirer et archiver la source/);
  assert.match(app, /const documentIds = Array\.isArray\(sourceData\.documentIds\) \? sourceData\.documentIds\.filter\(id => id !== documentId\) : \[\]/);
  assert.match(app, /createSourceDocument\(\{ \.\.\.sourceData, documentIds, \.\.\.\(action === "archive" \? \{ status: "archived" \} : \{\}\) \}\)/);
  assert.match(app, /genealogyStore\.reviseOfficial\(\{ type: "source", id: sourceId, revisionId, eventId, data: revisedData/);
  assert.match(app, /data-managed-source-remove/);
  assert.match(app, /if \(!isAdminUser\(\)\) return toast\("La gestion des associations est réservée aux administrateurs/);
  assert.doesNotMatch(app.match(/function removeDocumentSourceAssociation[\s\S]*?\n\}/)?.[0] || "", /deleteDoc|updateDoc\(doc\(db, "documents"/);
  assert.match(app, /if \(activeDocumentSourceManagerId && \$\("genealogyItemDialog"\)\.open\) renderDocumentSourceManager\(activeDocumentSourceManagerId\)/);
});

test("une preuve archivée conserve sa trace par révision et reste accessible dans Historique", () => {
  assert.match(app, /function archiveOfficialProof\(proofId\)/);
  assert.match(app, /to: "historical", reason: "Preuve archivée par un administrateur"/);
  assert.match(app, /type: "proof", id: proofId, revisionId, eventId, data: archived/);
  assert.match(app, /kind === "history" && !\(item\.kind === "event" \|\| \(item\.kind === "proof" && item\.data\.technicalStatus === "historical"\)\)/);
  assert.match(app, /item\.kind === "proof" && item\.data\.technicalStatus === "historical"/);
  assert.doesNotMatch(app.match(/function archiveOfficialProof[\s\S]*?\n\}/)?.[0] || "", /deleteDoc/);
  assert.match(html, /<option value="history">Historique et preuves archivées<\/option>/);
});

test("les Archives séparent vue principale, sources sans association, documents et historique", () => {
  for (const [value, label] of [["main", "Vue principale"], ["archived-sources", "Sources archivées"], ["unassociated", "Sources sans association"], ["legacy-documents", "Documents historiques"]]) {
    assert.match(html, new RegExp(`<option value="${value}"[^>]*>${label}<\\/option>`));
  }
  assert.match(app, /kind === "main" && !\([\s\S]*item\.kind === "source" && sourceStatus === "active" && sourceAssociated === true/);
  assert.match(app, /kind === "unassociated" && !\(item\.kind === "source" && sourceStatus === "active" && sourceDependencySnapshotComplete\(\) && !sourceAssociated\)/);
  assert.match(app, /const associationLoadStatus = kind === "unassociated" && !sourceDependencySnapshotComplete\(\)/);
  assert.match(app, /kind === "archived-sources" && !\(item\.kind === "source" && sourceStatus === "archived"\)/);
  assert.match(app, /kind === "legacy-documents" && item\.kind !== "legacy-source"/);
});

test("les textes, aides et statut readonly sont appliqués à chaque ouverture et changement de type", () => {
  for (const id of ["genealogyContributionSubtitle", "genealogyContributionSubmitBtn", "genealogyContributionTargetHelp", "genealogyContributionPayloadHelp"]) {
    assert.ok(html.includes(`id="${id}"`), `élément de formulaire absent : ${id}`);
  }
  assert.match(app, /configureGenealogyContributionDialog\(\{/);
  assert.match(app, /\$\("genealogyContributionType"\)\.addEventListener\("change", updateGenealogyContributionPresentation\)/);
  assert.match(app, /\$\("genealogyContributionDialog"\)\.dataset\.official = String\(officialMode\)[\s\S]*?\$\("genealogyContributionDialog"\)\.dataset\.revision = String\(!!reviseItem\)[\s\S]*?updateGenealogyContributionPresentation\(\)/);
  assert.match(app, /primaryAction: \$\("genealogyContributionSubmitBtn"\)/);
  assert.match(app, /target: \$\("genealogyContributionTarget"\)/);
  assert.match(app, /type: \$\("genealogyContributionType"\)\.value/);
  assert.match(app, /if \(official\) \{[\s\S]*?genealogyStore\.reviseOfficial\([\s\S]*?genealogyStore\.createOfficial\([\s\S]*?\} else \{[\s\S]*?genealogyStore\.createProposal\(/);
});

test("la source officielle référence des documents sélectionnés sans recopier leurs fichiers", () => {
  for (const id of ["genealogySourceDocumentPicker", "genealogySourceDocumentSearch", "genealogySourceDocumentOptions", "genealogySourceDocumentSelection"]) {
    assert.ok(html.includes(`id="${id}"`), `sélecteur de documents absent : ${id}`);
  }
  assert.match(html, /Rechercher dans la bibliothèque/);
  assert.match(html, /placeholder="Titre, nom de fichier ou type"/);
  assert.match(app, /Aucun document n’est disponible/);
  assert.match(app, /const matches = rawQuery \? searchLinkedDocuments\(documents, rawQuery\) : \[\]/);
  assert.match(app, /documentIds: \[\.\.\.selectedGenealogySourceDocumentIds\]/);
  assert.match(app, /sourceData\.documentIds/);
  assert.match(app, /Document référencé introuvable/);
  assert.match(app, /data-source-document-open=/);
  assert.match(app, /linkedDocumentButton\.dataset\.sourceDocumentOpen[\s\S]*?openStoredDocument\(linkedDocument, "archives"\)/);
  assert.match(app, /data-managed-source-open=/);
  assert.match(app, /openGenealogyItem\("source", managedSourceOpen\.dataset\.managedSourceOpen\)/);
  assert.match(app, /if \(collectionName === "sourceDocuments"\) \{[\s\S]*?renderDocuments\(\)[\s\S]*?renderDocumentSourceManager\(activeDocumentSourceManagerId\)/);
  assert.match(app, /if \(!tile \|\| event\.target\.closest\("button, a, input, select, textarea, summary, \.tile-context-actions"\)\) return/);
  assert.doesNotMatch(app.match(/if \(type === "source"\) \{([\s\S]*?)\} else if \(type === "transcription"\)/)?.[1] || "", /writeFileChunks|setDoc\(doc\(db, "documents"/);
  assert.match(html, /Sélectionnez les fiches existantes utilisées par cette source\. Les fichiers ne sont pas copiés\./);
});

test("le sélecteur de documents est paginé, masqué sans recherche et conserve la sélection", () => {
  assert.match(html, /id="genealogySourceDocumentMore"[\s\S]{0,200}?Afficher plus de résultats<\/button>/);
  assert.match(app, /const shown = SOURCE_DOCUMENT_PICKER_PAGE_SIZE \* genealogySourceDocumentPagesShown/);
  assert.match(app, /const visibleMatches = matches\.slice\(0, shown\)/);
  assert.match(app, /moreButton\.hidden = !\(rawQuery && matches\.length > shown\)/);
  assert.match(app, /Saisissez au moins un caractère pour rechercher dans la bibliothèque par titre, nom de fichier ou type\./);
  assert.match(app, /\$\("genealogySourceDocumentMore"\)\.addEventListener\("click", \(\) => \{[\s\S]*?genealogySourceDocumentPagesShown \+= 1;[\s\S]*?renderGenealogySourceDocumentPicker\(\)/);
  assert.match(app, /genealogySourceDocumentPagesShown = 1;[\s\S]{0,80}?genealogySourceDocumentLastQuery = null;/);
  assert.match(app, /if \(genealogySourceDocumentLastQuery !== rawQuery\) \{[\s\S]*?genealogySourceDocumentPagesShown = 1;/);
});

test("les résultats documentaires reprennent la liste flottante des personnes et des capsules ivoire", () => {
  assert.ok(app.includes("genealogySourceDocumentSearchControl.append("));
  assert.ok(app.includes('$("genealogySourceDocumentOptions")'));
  assert.ok(app.includes('$("genealogySourcePersonSearch").type = "search"'));
  assert.ok(app.includes('.querySelectorAll("[data-genealogy-source-document]")[genealogySourceDocumentActiveIndex]?.scrollIntoView({ block: "nearest" })'));
  assert.ok(app.includes('class="source-document-option person-multiselect-result'));
  assert.ok(app.includes('icon("document", "source-document-selection-icon")'));
  assert.match(css, /\.source-document-selection-item\s*\{[^}]*background: var\(--color-surface\);[^}]*color: var\(--color-text\)/);
  assert.match(css, /\.source-document-picker-options\.person-multiselect-results\s*\{[^}]*position: fixed;/);
  assert.match(css, /\.person-multiselect-results\s*\{[^}]*position: absolute;[\s\S]*?box-shadow: var\(--shadow-low\)/);
  assert.match(css, /\.genealogy-source-guided-fields > section \.person-multiselect-chip\s*\{[^}]*background: var\(--color-surface\)/);
  assert.match(css, /\.selection-chip-remove\s*\{[^}]*min-width: var\(--control-touch\);[^}]*min-height: var\(--control-touch\)/);
});

test("les cartes Sources & preuves présentent un résumé humain sans JSON brut", () => {
  const workspace = app.match(/function renderGenealogyWorkspace\(\) \{[\s\S]*?\r?\n\}\r?\n/)?.[0] || "";
  assert.ok(workspace.length > 500, "le rendu du dossier est présent");
  assert.doesNotMatch(workspace, /JSON\.stringify/);
  assert.doesNotMatch(app, /genealogy-entry-content/);
  assert.match(app, /function genealogyEntryBits\(item\)/);
  assert.match(app, /: genealogyEntryContent\(item\)/);
  assert.match(app, /const searchText = searchable\(\[genealogyItemTitle\(item\), \.\.\.genealogyEntryBits\(item\)\]\.join\(" "\)\)/);

  assert.match(app, /"source.created": "Source créée"/);
  assert.match(app, /"source.revised": "Source révisée"/);
  assert.match(app, /"proposal.submitted": "Proposition soumise"/);
  assert.match(app, /"proposal.accepted": "Proposition acceptée"/);
  assert.match(app, /"proposal.rejected": "Proposition refusée"/);
  assert.match(app, /genealogyEventLabel\(data\.eventType\)/);

  assert.match(app, /Catégorie : \$\{data\.category\}/);
  assert.match(app, /Conservé par |Cote : \$\{data\.cote\}/);
  assert.match(app, /Personnes concernées : \$\{peopleNames\.join\(", "\)\}/);
  const proofBits = app.match(/if \(kind === "proof"\) \{[\s\S]*?\n  \}/)?.[0] || "";
  assert.ok(proofBits.length > 100, "branche de résumé des cartes Preuve présente");
  assert.match(proofBits, /Personnes concernées : \$\{peopleNames\.join\(", "\)\}/, "cartes Preuves : personnes réellement associées affichées");
  assert.match(proofBits, /Aucune personne associée/, "cartes Preuves : état vide explicite");
  assert.match(app, /Document référencé introuvable/);
  assert.match(app, /référence\$\{missing > 1 \? "s" : ""\} introuvable\$\{missing > 1 \? "s" : ""\} dans la bibliothèque chargée/);
  assert.match(app, /Chargement de la bibliothèque…/);
  assert.match(app, /Observations : \$\{genealogyExcerpt\(/);
  assert.match(app, /\$\{passages\.length\} passage\$/);
  assert.match(app, /Valeur relevée : \$\{genealogyExcerpt\(/);
  assert.match(app, /Justification : \$\{genealogyExcerpt\(revision\.justification, 240\)\}/);
  assert.match(app, /Type de contribution : \$\{GENEALOGY_PROPOSAL_TYPE_LABELS\[record\.type\] \|\| record\.type\}/);
  assert.match(app, /resolutionReason\) bits\.push\(`Motif de la décision : \$\{genealogyExcerpt\(record\.resolutionReason, 240\)\}`\)/);
  assert.match(app, /Motif : \$\{genealogyExcerpt\(record\.reason, 240\)\}/);

  assert.match(app, /Auteur : \$\{authorLabel\}/);
  assert.match(app, /GENEALOGY_PROPOSAL_STATUS_LABELS\[record\.status\] \|\| record\.status/);
  assert.match(app, /GENEALOGY_CONCLUSION_STATUS_LABELS\[data\.revision\.status\]/);
  assert.match(css, /\.genealogy-entry-legacy-document/);
  assert.doesNotMatch(css, /genealogy-entry-content/);
});

test("le sélecteur conserve et retire plusieurs documents dont le titre ou l'auteur est révisé", () => {
  const workspace = app.match(/function renderGenealogySourceDocumentSelection\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(workspace, /Référence introuvable · \$\{id\}/);
  assert.match(workspace, /data-remove-genealogy-source-document/);
  assert.match(app, /openStoredDocument\(linkedDocument, "archives"\)/);
});

test("la fiche détaillée d'une source présente des faits structurés sans JSON", () => {
  const facts = app.match(/function sourceDetailFactsMarkup\(data\)[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(facts.length > 400, "la présentation détaillée des sources existe");
  for (const label of ["Statut", "Type ou catégorie", "Date", "Lieu", "Institution de conservation", "Fonds ou série", "Cote", "Sous-cote", "Référence archivistique", "Personnes concernées", "Observations"]) {
    assert.ok(facts.includes(`"${label}"`) || facts.includes(`>${label}</strong>`), `libellé de fiche source absent : ${label}`);
  }
  assert.doesNotMatch(facts, /JSON/);
  assert.match(facts, /Les informations archivistiques de cette source ne sont pas encore renseignées/);
  assert.match(app, /function renderSourcePage\(item, returnContext = null\)/, "les faits structurés sont intégrés à la page dédiée");
  assert.match(app, /sourceDetailFactsMarkup\(data\).*linkedSourceDocumentsMarkup\(data\)/);
});

test("Source et Preuve ont des pages dédiées, les autres fiches conservent leur modale", () => {
  assert.match(html, /<main class="workspace-view page-content-lane source-detail-view" id="sourceDetailView" hidden/);
  assert.match(html, /<main class="workspace-view page-content-lane source-detail-view proof-detail-view" id="proofDetailView" hidden/);
  assert.match(html, /id="sourcePageBackBtn"[^>]*aria-label="Retour"/);
  assert.match(html, /id="sourcePageActionsMenu"[^>]*role="menu"/);
  assert.match(html, /id="proofPageBackBtn"[^>]*aria-label="Retour"/);
  assert.match(html, /id="proofPageReviseBtn"[^>]*hidden/);
  assert.match(html, /id="proofPageActionsMenu"[^>]*role="menu"/);
  assert.match(html, /id="genealogyItemDialog"[^>]*class="modal-lg/);
  assert.match(app, /if \(kind === "source"\) return renderSourcePage\(item, itemReturnContext\)/, "Source routée vers la page");
  assert.match(app, /if \(kind === "proof"\) return renderProofPage\(item, itemReturnContext\)/, "Preuve routée vers la page");
  assert.match(app, /function renderProofPage\(item, returnContext = null\)/);
  assert.match(app, /proofDetailsMarkup\(data, record\)/, "détails métier de Preuve réutilisés");
  assert.match(app, /proofPageReturnContextFor\(item\)/, "contexte de retour partagé");
  assert.match(app, /sourceTranscriptionsMarkup\(record, data\)/, "transcriptions associées présentées");
  assert.match(app, /sourceProofsMarkup\(record, data\)/, "preuves liées présentées");
  assert.match(app, /sourceHistoryMarkup\(record\)/, "historique des révisions présenté");
  assert.match(css, /\.source-detail-page \{ width: min\(100%, 76rem\)/, "largeur de page desktop bornée");
  assert.match(css, /\.source-detail-actions-menu \.btn \{[^}]*min-height: var\(--control-touch\)/, "actions secondaires tactiles");
  assert.match(css, /\.proof-detail-revise \{ min-height: var\(--control-touch\)/, "action principale révision visible");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.source-detail-transcription \{ align-items: stretch; flex-direction: column; \}/, "lecture verticale sur mobile");
});

test("la page Preuve conserve les détails métier, les Sources et l'historique sans relations inventées", () => {
  const proofPage = app.match(/function renderProofPage\(item, returnContext = null\) \{[\s\S]*?\n\}/)?.[0] || "";
  const sourceMarkup = app.match(/function proofSourceMarkup\(proofItem\) \{[\s\S]*?\n\}/)?.[0] || "";
  const sourceFinder = app.match(/function sourceRecordsForProof\(proofData\) \{[\s\S]*?\n\}/)?.[0] || "";
  const historyMarkup = app.match(/function proofHistoryMarkup\(proofRecord\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(proofPage.length > 500, "composition de la page Preuve présente");
  assert.match(proofPage, /proofDetailsMarkup\(data, record\)/, "faits, personnes, citation et interprétation réutilisés");
  assert.doesNotMatch(proofPage, /JSON\.stringify|<pre>/, "aucun JSON brut sur la page Preuve");
  assert.match(sourceFinder, /record\.id === proofData\.documentId/, "Source liée par documentId existant");
  assert.match(sourceFinder, /data\.documentIds\.includes\(proofData\.documentId\)/, "association par identifiant de document déclaré");
  assert.match(sourceMarkup, /Aucune source officielle n’est associée au document référencé/);
  assert.match(historyMarkup, /genealogyProofRevisions\.filter\(revision => revision\.objectId === proofRecord\.id\)/);
  assert.match(app, /Aucun document associé à cette preuve/, "absence de document distinguée d'une référence manquante");
  assert.match(app, /Aucune personne n’est associée à cette preuve\./, "association de personnes facultative");
});

test("la présentation Source reste structurée, sans JSON brut et avec un état média explicite", () => {
  const sourcePage = app.match(/function renderSourcePage\(item, returnContext = null\) \{[\s\S]*?\n\}/)?.[0] || "";
  const images = app.match(/function sourcePageImagesMarkup\(item\) \{[\s\S]*?\n\}/)?.[0] || "";
  const transcriptions = app.match(/function sourceTranscriptionsMarkup\(sourceRecord, sourceData\) \{[\s\S]*?\n\}/)?.[0] || "";
  const proofs = app.match(/function sourceProofsMarkup\(sourceRecord, sourceData\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(sourcePage.length > 500, "composition de la page Source présente");
  assert.doesNotMatch(sourcePage, /JSON\.stringify|<pre>/, "aucun JSON brut dans la page Source");
  assert.match(images, /genealogy-photo-panel/, "aperçu de page/photographie conservé");
  assert.match(images, /Aucune photographie n’est associée à cette page\./, "absence de photographie explicitée");
  assert.match(images, /Les photos sont référencées, mais leur aperçu n’est pas disponible/, "référence sans aperçu signalée");
  assert.match(transcriptions, /Aucune transcription n’est rattachée à cette source\./, "état vide transcription explicite");
  assert.match(proofs, /Aucune preuve n’est liée à cette source\./, "état vide preuves explicite");
  /* Invariants conservés pour les autres fiches restées en modale. */
  assert.match(app, /kind !== "source" && JSON\.stringify\(data\) !== "\{\}" \? `<pre>/);
  assert.match(app, /Aucune preuve n’est rattachée à cet élément\./);
  assert.match(app, /: kind === "source" \|\| kind === "proof" \? "" : `<section><div class="genealogy-photo-panel"><p>Aucune photographie n’est associée à cette page\.<\/p><\/div><\/section>`/);
});

test("les documents associés d'une source sont mis en valeur avec consultation de l'original", () => {
  for (const expected of [
    "Documents associés (${links.length})",
    "Aucun document de la bibliothèque n’est associé à cette source.",
    "Consulter l’original",
    "Fichier disponible",
    "Fiche sans fichier consultable",
    "Fiche trouvée, aucun fichier ou lien consultable n’est associé."
  ]) assert.ok(app.includes(expected), `élément de la section documents absent : ${expected}`);
  assert.match(app, /data-source-document-open="\$\{esc\(link\.id\)\}"/);
  assert.match(css, /\.genealogy-linked-documents \{[\s\S]*?background: var\(--color-surface-muted\)/);
  assert.match(css, /\.source-detail-facts \{/);
  assert.match(css, /\.source-detail-fact \{/);
  assert.match(css, /\.source-document-reference-missing \{/);
});

test("les deux espaces naviguent entre sources et documents, avec références absentes signalées", () => {
  assert.match(app, /function linkedSourceDocumentsMarkup\(sourceData\)/);
  assert.match(app, /resolveSourceDocumentLinks\(sourceData, documents\)/);
  assert.match(app, /Document référencé introuvable/);
  assert.match(app, /Fiche trouvée, aucun fichier ou lien consultable n’est associé/);
  assert.match(app, /const linkedDocumentsBlock = kind === "source" \? linkedSourceDocumentsMarkup\(data\) : ""/);
  assert.match(app, /const linkedSources = sourceDocumentsLoaded \? documentLinkedSources\(item\.id\)/);
  assert.match(app, /Array\.isArray\(sourceData\.documentIds\) && sourceData\.documentIds\.includes\(documentId\)/);
  assert.match(app, /data-managed-source-open="\$\{esc\(source\.id\)\}"/);
  assert.match(app, /openGenealogyItem\("source", sourceLink\.dataset\.openDocumentSource\)/);
  assert.match(app, /data-source-document-open="\$\{esc\(link\.id\)\}"/);
  assert.match(app, /openStoredDocument\(linkedDocument, "archives"\)/);
  assert.match(app, /if \(collectionName === "sourceDocuments"\) \{[\s\S]*?if \(loadedPeople && loadedDocuments\) renderDocuments\(\)/);
});

test("transcriptions, incertitudes, photos, contradictions et accès depuis les fiches sont affichés", () => {
  assert.match(html, /id="personGenealogyEvidenceList"/);
  assert.match(app, /Transcription italienne et traduction française/);
  assert.match(app, /Hypothèse/);
  assert.match(app, /Contradiction à examiner/);
  assert.match(app, /Photo \$\{index \+ 1\}/);
  assert.match(app, /data-genealogy-passage/);
  assert.match(app, /data-genealogy-zoom/);
});

test("l'interface distingue les médias historiques optimisés et indique l'absence de stockage photographique durable", () => {
  const documents = app.match(/function renderDocuments\(\)[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(documents, /Image historique optimisée|Fichier historique · original non vérifié|Référence externe/);
  assert.match(app, /stockage durable n’est pas disponible/);
  assert.match(css, /\.genealogy-detail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.genealogy-detail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("la consultation depuis Documents compose une fiche unifiée sans remplacer les modèles existants", () => {
  const details = app.match(/function renderUnifiedDocumentDetails\(item\)[\s\S]*?\n\}/)?.[0] || "";
  assert.match(html, /class="document-unified-layout"/);
  assert.match(html, /class="document-original-panel"/);
  assert.match(html, /id="viewerDocumentDetails"/);
  assert.match(details, /Informations fichier/);
  assert.match(details, /Personnes concernées/);
  assert.match(details, /Sources et provenance/);
  assert.match(details, /linkedSources\.map\(source/);
  assert.match(details, /data-unified-source-card=/, "carte Source cliquable depuis le volet");
  assert.match(details, /Aucune source officielle n’est associée à cette fiche/);
  assert.match(app, /async function openStoredDocument\(item, returnContext = "previous"\)/);
  assert.match(app, /if \(item\.chunkCount && item\.chunkVersion\)[\s\S]*?readChunkedFile\(item\)/);
  assert.match(app, /\$\("viewerExternalBtn"\)\.href = source/);
  assert.match(app, /\$\("viewerImage"\)\.src = source/);
  assert.match(app, /if \(mimeType\.startsWith\("image\/"\)\)/);
  assert.match(app, /data-unified-source-card=/);
  assert.match(app, /data-unified-person=/);
  assert.match(app, /openStoredDocument\(item, "documents"\)/);
  assert.match(app, /if \(collectionName === "sourceDocuments"\)[\s\S]*?renderUnifiedDocumentDetails\(viewedDocument\)/);
  assert.doesNotMatch(details, /JSON\.stringify/);
});

test("l'export v5 est raccordé et une archive v5 restaure uniquement en prévisualisation", () => {
  assert.match(app, /createBackupArchiveManifest\(\{/);
  assert.match(app, /generateBackupZip\(archive, JSZip/);
  assert.match(app, /if \(archiveVersion === BACKUP_ARCHIVE_VERSION\)/);
  assert.match(app, /prepareBackupRestorePlan\(archive\.manifest/);
  assert.match(app, /aucune écriture ne sera exécutée depuis cette interface/i);
});

test("la fiche unifiée du document réutilise le viewer et affiche métadonnées, personnes et toutes les sources liées", () => {
  const unified = app.match(/function renderUnifiedDocumentDetails\(item\)[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(unified.length > 500);
  for (const field of ["item.type", "item.date", "item.place", "item.notes", "item.personIds"]) assert.ok(unified.includes(field), `champ documentaire absent : ${field}`);
  assert.match(unified, /documentLinkedSources\(item\.id\)/);
  assert.match(unified, /linkedSources\.map\(source/);
  assert.match(unified, /data-unified-source-card=/, "carte Source cliquable");
  assert.match(unified, /"Format", fileFormat/);
  assert.match(unified, /Date d'ajout/);
  assert.match(unified, /Taille/);
  assert.match(unified, /Date du document/);
  assert.doesNotMatch(unified, /data-unified-document-edit=/, "le bouton Modifier a quitté le volet Informations");
  assert.match(unified, /<h4>Preuves<\/h4>/, "section Preuves dédiée présente");
  assert.match(unified, /data-unified-proof-card=/, "carte Preuve cliquable depuis le volet");
  assert.doesNotMatch(unified, />Consulter la preuve</, "CTA de consultation redondant retiré");
  assert.match(unified, /data-create-proof-from-document=/, "CTA Créer une preuve en en-tête de section");
  assert.match(unified, /linkedProofs\.filter|genealogyRecordData\(proof\)\.documentId === item\.id/);
  assert.doesNotMatch(unified, /JSON\.stringify/);
  assert.match(app, /async function openStoredDocument\(item, returnContext = "previous"\)/);
  assert.match(app, /readChunkedFile\(item\)/);
  assert.match(app, /openStoredDocument\(item, "documents"\)/);
});

test("la fiche document unifiée raccorde l'ajout et la gestion de Source officielle pour les administrateurs", () => {
  const unified = app.match(/function renderUnifiedDocumentDetails\(item\)[\s\S]*?\n\}/)?.[0] || "";
  assert.ok(unified.length > 500);
  assert.match(unified, /isAdminUser\(\)\s+\?\s+linkedSources\.length/);
  assert.match(unified, /linkedSources\.length\s+\?\s*`<button[^`]*data-manage-sources-from-document[^`]*<\/button>`\s*:\s*`<button[^`]*data-create-source-from-document[^`]*<\/button>`/);
  assert.match(unified, /const sourceHead = `<div class="document-unified-section-head"><h4>Sources et provenance<\/h4>\$\{sourceActions\}<\/div>`/, "en-tête de section avec CTA");
  assert.match(unified, /\$\{sourceHead\}\$\{sourceMarkup\}/, "en-tête raccordé à la section Sources");
  assert.match(app, /function refreshUnifiedDetailsIfOpen\(\) \{[\r\n\s]*if \(!\$\("documentViewerDialog"\)\.open/);
  assert.match(app, /\$\("genealogyItemDialog"\)\.addEventListener\("close", \(\) => \{[\r\n\s]*genealogyItemReturn = null;[\s\S]{0,160}?if \(reopenUnifiedDocumentAfter\("genealogyItemDialog"\)\) return;/);
  assert.match(unified, /\+ Ajouter une source/, "CTA source compact, aligné sur « + Créer une preuve »");
  assert.doesNotMatch(unified, /Ajouter une source officielle/, "ancien libellé long retiré");
  assert.match(unified, /data-create-source-from-document="\$\{esc\(item\.id\)\}"/);
  assert.match(unified, /data-manage-sources-from-document="\$\{esc\(item\.id\)\}"/);
  assert.match(app, /\$\("viewerDocumentDetails"\)\.addEventListener\("click"/);
  assert.match(app, /closest\("\[data-create-source-from-document\]"\);[\r\n\s]*if \(createSource\) return openOfficialSourceFromDocument\(createSource\.dataset\.createSourceFromDocument\)/);
  assert.match(app, /closest\("\[data-manage-sources-from-document\]"\);[\r\n\s]*if \(manageSources\) return renderDocumentSourceManager\(manageSources\.dataset\.manageSourcesFromDocument\)/);
  assert.match(app, /function openOfficialSourceFromDocument\(documentId\)/);
  assert.match(app, /function renderDocumentSourceManager\(documentId\)/);
});

test("la fiche de consultation d'une preuve affiche des informations métier sans JSON brut", () => {
  const proofPanel = app.match(/function proofDetailsMarkup[\s\S]{0,6000}?\n\}/)?.[0] || "";
  assert.ok(proofPanel.length > 500, "panneau de consultation présent");
  assert.doesNotMatch(proofPanel, /JSON\.stringify/, "aucun JSON brut dans la vue principale");
  assert.match(app, /if \(data\.factType\) return proofFactLabel\(data\.factType\)/, "titre traduit");
  assert.match(proofPanel, /PROOF_RELATION_LABELS\[data\.relation\]/, "relation traduite");
  assert.match(proofPanel, /data-genealogy-person=/, "personnes consultables");
  assert.match(proofPanel, /data-source-document-open=/, "document consultable");
  assert.match(proofPanel, /Statut et détails techniques/, "panneau technique replié");
  assert.match(proofPanel, /person-chip person-chip-consult/, "pastille commune personne en consultation");
  assert.match(proofPanel, /<section class="document-unified-section"><h4>Personnes concernées/, "capsules placées dans le panneau beige partagé");
  assert.match(css, /\.document-unified-section \.person-chip \{ background: var\(--color-surface\); border: var\(--border-default\); \}/);
  assert.match(html, /id="genealogyItemBackBtn"[^>]*aria-label="Revenir à la fiche précédente"/, "bouton de retour entre fiches");
  assert.match(app, /genealogyItemReturn = \{ kind: activeGenealogyItem\.kind/, "pile de retour mémorisée");
  assert.match(app, /proofFactLabel\(proofData\.factType\)[\s\S]{0,400}PROOF_RELATION_LABELS\[proofData\.relation\]/, "preuves liées traduites");
  assert.match(app, /const GENEALOGY_RELATION_LABELS = PROOF_RELATION_LABELS/, "relations centralisées");
  assert.match(app, /class="person-multiselect-chips" id="genealogySourcePersonSelection"/, "pastille commune en sélection, modèle Documents");
  assert.match(app, /kind === "proof" \? proofDetailsMarkup\(data, record\)/, "branche de consultation dédiée");
  assert.match(app, /const photo = kind === "proof" \? "" : pages\.length/, "aucune zone photo vide pour une preuve");
  assert.match(app, /if \(kind === "proof" && proof\.id === record\.id\) return false;/, "preuve courante exclue des preuves liées");
  assert.match(app, /dataset\.genealogyPassagePropose \?\? passageProofButton\.dataset\.genealogyPassage/, "index du passage lu sur le bon attribut");
});

test("le formulaire guidé de preuve remplace le JSON pour les créations officielles", () => {
  assert.match(app, /from "\.\/genealogy-proof-form\.js"/);
  const release = html.match(/<meta name="asset-release" content="([^"]+)"/)?.[1] || "";
  assert.ok(release && html.includes(`./js/genealogy-proof-form.js?v=${release}`), "module guidé versionné avec le jeton de publication courant");
  assert.match(app, /genealogyProofGuidedGrid\.id = "genealogyOfficialProofFields"/);
  assert.match(app, /Fait à documenter[\s\S]{0,6000}?Provenance[\s\S]{0,6000}?Citation[\s\S]{0,6000}?Interprétation/);
  assert.match(app, /const guidedProof = officialMode && contributionType === "proof"/);
  assert.match(app, /official && type === "proof" \? proofGuidedPayload\(targetId\)/, "payload guidé aussi en création et en révision");
  assert.match(app, /reviseItem\?\.kind === "proof"[\s\S]{0,400}?fillOfficialProofGuidedFields\(\{/, "révision préremplie dans le formulaire guidé");
  assert.match(app, /La révision guidée conserve les champs non exposés/, "champs hérités conservés à la révision");
  const guidedPayload = app.match(/function proofGuidedPayload\(fallbackFactId = ""\) \{[\s\S]{0,700}?\n\}/)?.[0] || "";
  assert.ok(guidedPayload.includes("validateProofGuidedFields"), "validation du modèle avant écriture");
  assert.doesNotMatch(guidedPayload, /JSON\.stringify/, "aucun JSON exposé au flux guidé");
  assert.match(app, /proofContext: \{ personIds: \[personId\] \}/, "entrée fiche personne");
  assert.match(app, /data-create-proof-from-document=/, "entrée fiche document");
  assert.match(app, /passageDocumentId/, "entrée passage de transcription");
  assert.match(app, /isAdminUser\(\) \? "Ajouter une preuve" : "Proposer une preuve"/, "libellé dynamique fiche personne");
  assert.match(app, /isAdminUser\(\) \? "Créer une preuve sur ce passage" : "Proposer une preuve sur ce passage"/, "libellé dynamique passage");
  assert.match(app, /if \(isAdminUser\(\)\) \{\s+return openGenealogyContribution\(\{\s+official: true,\s+proofContext: \{ personIds: \[personId\] \}/, "admin → guidé, contributeur → proposition");
  assert.match(app, /la transcription d’origine n’est jamais modifiée/, "citation figée sans altération de la transcription");
  assert.match(app, /submitButton\.disabled = true;[\s\S]{0,15000}?submitButton\.disabled = false;/, "protection double soumission");
  assert.match(app, /buildProofGuidedInput\(fields\)/, "composition via le module pur");
});

test("la fiche unifiée permet de modifier document, source et naviguer vers les personnes", () => {
  assert.match(html, /id="viewerEditBtn"[^>]*>Modifier les informations/, "la modification reste accessible depuis le menu …");
  assert.match(app, /closest\("\[data-unified-document-edit\]"\)/, "ancien chemin conservé pour compatibilité");
  assert.match(app, /data-unified-person=/);
  assert.match(app, /function openUnifiedDocumentEditor\(documentId\)/);
  assert.match(app, /function openUnifiedSource\(documentId, sourceId, revise = false\)/);
  assert.match(app, /openGenealogyContribution\(\{ official: true, reviseItem: \{ kind: "source"/);
  assert.match(app, /reopenUnifiedDocumentAfter\("documentDialog"\)/);
  assert.match(app, /reopenUnifiedDocumentAfter\("genealogyContributionDialog"\)/);
  assert.match(html, /document-unified-layout/);
  assert.match(html, /document-unified-details/);
  assert.match(css, /\.document-unified-layout \{ display: grid; grid-template-columns: minmax\(0, 1\.2fr\) minmax\(19rem, \.8fr\)/);
  assert.match(css, /\.viewer-dialog \.document-unified-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
});

test("le visualiseur branche le zoom image et réserve le menu d’actions du header", () => {
  assert.match(app, /import \{ createDocumentImageViewer, selectInitialDocumentImageMode \} from "\.\/document-image-viewer\.js"/);
  assert.match(app, /initialMode: selectInitialDocumentImageMode\(\{ naturalWidth: image\.naturalWidth, naturalHeight: image\.naturalHeight \}\)/);
  assert.match(html, /id="viewerActionsBtn"[^>]*aria-haspopup="menu"/);
  assert.match(html, /id="viewerActionsMenu"[^>]*role="menu"/);
  assert.match(html, /id="viewerImageControls"[^>]*role="group"/);
  assert.match(app, /function setupViewerImage\(item\)[\s\S]*?createDocumentImageViewer\(/);
  assert.match(app, /zoomIndicator: \$\("viewerZoomIndicator"\)/);
  assert.match(app, /fullscreenButton: \$\("viewerFullscreenBtn"\)/);
  assert.match(app, /fullscreenHost: \$\("documentViewerDialog"\)\.querySelector\("\.document-original-panel"\)/);
  assert.match(app, /viewerImageControls"\)\.hidden = true/);
  assert.match(app, /if \(mimeType\.startsWith\("image\/"\)\)[\s\S]*?setupViewerImage\(item\)/);
  assert.match(app, /function setUnifiedDetailsCollapsed\(collapsed\)[\s\S]*?details\.hidden = collapsed/);
  assert.match(app, /setUnifiedDetailsCollapsed\(true\)/);
  assert.doesNotMatch(app, /if \(window\.innerWidth <= 760\) collapsed = false/);
  assert.match(html, /id="viewerDetailsExpandBtn" aria-controls="viewerDocumentDetails" aria-expanded="false"/);
  assert.match(html, /id="viewerDetailsCollapseBtn" aria-controls="viewerDocumentDetails" aria-expanded="true"/);
  assert.match(imageViewer, /image\.style\.width = `\$\{fitWidth \* zoom\}px`/);
  assert.match(imageViewer, /image\.style\.height = `\$\{fitHeight \* zoom\}px`/);
  assert.match(imageViewer, /image\.style\.transform = nativeWidthScroll \? "none" : "translate\(-50%, -50%\)"/);
  assert.doesNotMatch(imageViewer, /translate\(-50%, -50%\) scale\(\$\{zoom\}\)/);
  assert.match(imageViewer, /return naturalHeight \/ naturalWidth >= 1\.5 \? "width" : "fit"/);
});

test("les informations du viewer gardent leur repli unique et une mise en page mobile verticale", () => {
  assert.match(app, /\$\("viewerDetailsCollapseBtn"\)\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(app, /\$\("viewerDetailsExpandBtn"\)\.setAttribute\("aria-expanded", String\(!collapsed\)\)/);
  assert.match(app, /layout\.classList\.toggle\("is-details-collapsed", collapsed\)/);
  assert.match(app, /details\.hidden = collapsed/);
  assert.match(css, /\.document-unified-layout \{ display: grid; grid-template-columns: minmax\(0, 1\.2fr\) minmax\(19rem, \.8fr\)/);
  assert.match(css, /\.viewer-dialog \.document-unified-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.document-unified-layout\.is-details-collapsed \.document-original-panel \.viewer-body \{ height: min\(68dvh, calc\(100dvh - 13rem\)\)/);
  assert.match(css, /\.document-unified-details-content \{ display: grid; align-content: start; gap: var\(--space-4\);/);
  assert.match(css, /\.document-unified-fact--wide \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /\.viewer-dialog \.document-unified-source-actions \.btn \{ width: 100%; \}/);
  assert.match(html, /class="btn icon-btn viewer-details-toggle"[^>]*id="viewerDetailsCollapseBtn"/);
  assert.match(html, /class="btn icon-btn viewer-details-toggle"[^>]*id="viewerDetailsExpandBtn"/);
});

test("le viewer expose l’indicateur de zoom et les commandes de plein écran accessibles", () => {
  assert.match(html, /class="viewer-image-zoom-group viewer-image-only" role="group" aria-label="Zoom"/);
  assert.match(html, /id="viewerZoomIndicator" aria-hidden="true"/);
  assert.match(html, /id="viewerFullscreenBtn"[^>]*aria-label="Afficher en plein écran"/);
  assert.match(html, /<symbol id="icon-maximize"/);
  assert.match(html, /<symbol id="icon-minimize"/);
  assert.match(html, /<symbol id="icon-external-link"/);
  assert.match(imageViewer, /function showZoomIndicator\(\)/);
  assert.match(imageViewer, /Math\.round\(zoom \/ minZoom \* 100\)/);
  assert.match(imageViewer, /zoomIndicatorDuration = 1500/);
  assert.match(imageViewer, /fullscreenHost\?\.requestFullscreen/);
  assert.match(imageViewer, /setFullscreenState\(true, true\)/);
  assert.match(imageViewer, /zoomIndicatorTimer !== null\) globalThis\.clearTimeout/);
  assert.match(css, /\.viewer-zoom-indicator \{[\s\S]*?pointer-events: none/);
  assert.match(css, /#documentViewerDialog\.is-viewer-fullscreen \.document-original-panel \.viewer-body/);
});
