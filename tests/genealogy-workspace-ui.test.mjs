import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8")
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

test("le sélecteur de personnes est recherché, paginé et distinct des documents associés", () => {
  for (const id of ["genealogySourcePersonSearch", "genealogySourcePersonEmpty", "genealogySourcePersonOptions", "genealogySourcePersonMore", "genealogySourcePersonSelection"]) {
    assert.match(app, new RegExp(id), `sélecteur personne absent : ${id}`);
  }
  assert.match(app, /people\.filter\(item => searchable\(`\$\{item\.firstName \|\| ""\} \$\{item\.middleName \|\| ""\} \$\{item\.lastName \|\| ""\}`\)\.includes\(searchable\(rawQuery\)\)\)/);
  assert.match(app, /const shown = 10 \* genealogySourcePersonPagesShown/);
  assert.match(app, /matches\.slice\(0, shown\)/);
  assert.match(app, /genealogySourcePersonPagesShown \+= 1/);
  assert.match(app, /data-remove-genealogy-source-person/);
  assert.match(app, /directoryPersonName\(item\)/);
  assert.match(app, /formatDirectoryDate\(item\.birthDateInfo, item\.birthDate\)/);
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
  assert.match(app, /matches\.slice\(0, shown\)/);
  assert.match(app, /moreButton\.hidden = !\(rawQuery && matches\.length > shown\)/);
  assert.match(app, /Saisissez au moins un caractère pour rechercher dans la bibliothèque par titre, nom de fichier ou type\./);
  assert.match(app, /\$\("genealogySourceDocumentMore"\)\.addEventListener\("click", \(\) => \{[\s\S]*?genealogySourceDocumentPagesShown \+= 1;[\s\S]*?renderGenealogySourceDocumentPicker\(\)/);
  assert.match(app, /genealogySourceDocumentPagesShown = 1;[\s\S]{0,80}?genealogySourceDocumentLastQuery = null;/);
  assert.match(app, /if \(genealogySourceDocumentLastQuery !== rawQuery\) \{[\s\S]*?genealogySourceDocumentPagesShown = 1;/);
});

test("les cartes Sources & preuves présentent un résumé humain sans JSON brut", () => {
  const workspace = app.match(/function renderGenealogyWorkspace\(\) \{[\s\S]*?\n\}\n/)?.[0] || "";
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
  assert.match(app, /const sourceFactsBlock = kind === "source" \? sourceDetailFactsMarkup\(data\) : ""/);
});

test("la fiche détaillée évite le JSON et les photographies trompeuses pour les sources", () => {
  assert.match(app, /kind !== "source" && JSON\.stringify\(data\) !== "\{\}" \? `<pre>/);
  assert.match(app, /Aucune transcription n’est rattachée à cette source\./);
  assert.match(app, /Aucune preuve n’est rattachée à cet élément\./);
  assert.match(app, /: kind === "source" \? "" : `<section><div class="genealogy-photo-panel"><p>Aucune photographie n’est associée à cette page\.<\/p><\/div><\/section>`/);
  assert.match(app, /\? `\$\{sourceFactsBlock\}\$\{linkedDocumentsBlock\}<div class="genealogy-detail-grid">/);
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
  assert.match(details, /Informations documentaires/);
  assert.match(details, /Personnes concernées/);
  assert.match(details, /Sources et provenance/);
  assert.match(details, /linkedSources\.map\(source/);
  assert.match(details, /sourceDetailFactsMarkup\(sourceData\)/);
  assert.match(details, /Aucune source officielle n’est associée à cette fiche/);
  assert.match(app, /async function openStoredDocument\(item, returnContext = "previous"\)/);
  assert.match(app, /if \(item\.chunkCount && item\.chunkVersion\)[\s\S]*?readChunkedFile\(item\)/);
  assert.match(app, /data-unified-source-open=/);
  assert.match(app, /data-unified-source-revise=/);
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
  assert.match(unified, /sourceDetailFactsMarkup\(sourceData\)/);
  assert.match(unified, /data-unified-source-open=/);
  assert.match(unified, /data-unified-source-revise=/);
  assert.doesNotMatch(unified, /JSON\.stringify/);
  assert.match(app, /async function openStoredDocument\(item, returnContext = "previous"\)/);
  assert.match(app, /readChunkedFile\(item\)/);
  assert.match(app, /openStoredDocument\(item, "documents"\)/);
});

test("la fiche unifiée permet de modifier document, source et naviguer vers les personnes", () => {
  assert.match(app, /data-unified-document-edit=/);
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
  assert.match(app, /viewerImageControls"\)\.hidden = true/);
  assert.match(app, /if \(mimeType\.startsWith\("image\/"\)\)[\s\S]*?setupViewerImage\(item\)/);
  assert.match(app, /if \(window\.innerWidth <= 760\) collapsed = false/);
});
