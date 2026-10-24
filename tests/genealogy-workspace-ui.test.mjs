import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [html, app, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../js/app.js", import.meta.url), "utf8"),
  readFile(new URL("../css/design-system.css", import.meta.url), "utf8")
]);

test("la navigation Sources & preuves est intégrée aux vues privées", () => {
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
  assert.match(app, /data-genealogy-open="\$\{esc\(item\.kind\)\}"/);
  assert.match(app, /if \(kind === "legacy-source"[\s\S]*?openStoredDocument\(item\.record\)/);
  assert.match(css, /\.genealogy-entry-legacy-document/);
});
test("propositions, décisions, révisions et réexamens passent par le magasin sécurisé du lot 6", () => {
  for (const operation of ["createProposal", "submitProposal", "cancelDraft", "decideProposal", "createOfficial", "reviseOfficial", "createReexaminationEvent", "markNotificationRead"]) {
    assert.ok(app.includes(`genealogyStore.${operation}(`), `opération du magasin absente : ${operation}`);
  }
  assert.match(app, /hidden = !isAdminUser\(\)/);
  assert.match(app, /data-genealogy-proposal-action="accept"/);
  assert.match(app, /data-genealogy-review=/);
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

test("Documents propose une source sans duplication et permet la révision des sources liées", () => {
  assert.match(app, /data-create-source-from-document="\$\{esc\(item\.id\)\}"/);
  assert.match(app, /Créer une source à partir de ce document/);
  assert.match(app, /data-document-source-revise="\$\{esc\(source\.id\)\}"/);
  assert.match(app, /function openOfficialSourceFromDocument\(documentId\)/);
  assert.match(app, /if \(linkedSources\.length\) return toast\("Une source officielle référence déjà ce document/);
  assert.match(app, /openGenealogyContribution\(\{ official: true, sourceDocument: documentItem \}\)/);
  assert.match(app, /function reviseOfficialSourceFromDocument\(sourceId\)/);
  assert.match(app, /openGenealogyContribution\(\{ official: true, reviseItem: \{ kind: "source"/);
  assert.match(app, /const createSourceButton = event\.target\.closest\("\[data-create-source-from-document\]"\)/);
});

test("la création et la révision source utilisent le store officiel sans écraser les révisions", () => {
  assert.match(app, /genealogyStore\.createOfficial\(\{ type, id: officialId, revisionId, eventId, data: officialData/);
  assert.match(app, /genealogyStore\.reviseOfficial\(\{ type, id: officialId, revisionId, eventId, data: officialData/);
  assert.match(app, /genealogySourceOriginalData = reviseItem\?\.kind === "source" \? structuredClone/);
  assert.match(app, /documentIds: \[\.\.\.selectedGenealogySourceDocumentIds\]/);
  assert.doesNotMatch(app.match(/if \(type === "source"\) \{[\s\S]*?\} else if \(type === "transcription"\)/)?.[0] || "", /writeFileChunks|setDoc\(doc\(db, "documents"/);
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
  assert.match(app, /linkedDocumentButton\.dataset\.sourceDocumentOpen[\s\S]*?openStoredDocument\(linkedDocument\)/);
  assert.match(app, /sourceData\.documentIds[\s\S]*?data-open-document-source=/);
  assert.match(app, /openGenealogyItem\("source", sourceLink\.dataset\.openDocumentSource\)/);
  assert.match(app, /if \(collectionName === "sourceDocuments" && loadedPeople && loadedDocuments\) renderDocuments\(\)/);
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
  assert.match(app, /openStoredDocument\(linkedDocument\)/);
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
  assert.match(app, /const linkedSources = sourceDocumentsLoaded \? genealogyRecords\.sourceDocuments\.filter/);
  assert.match(app, /sourceData\.documentIds\.includes\(item\.id\)/);
  assert.match(app, /data-open-document-source="\$\{esc\(source\.id\)\}"/);
  assert.match(app, /openGenealogyItem\("source", sourceLink\.dataset\.openDocumentSource\)/);
  assert.match(app, /data-source-document-open="\$\{esc\(link\.id\)\}"/);
  assert.match(app, /openStoredDocument\(linkedDocument\)/);
  assert.match(app, /if \(collectionName === "sourceDocuments" && loadedPeople && loadedDocuments\) renderDocuments\(\)/);
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
  assert.match(app, /Image historique optimisée \(WebP\) · pas un original/);
  assert.match(app, /stockage durable n’est pas disponible/);
  assert.match(css, /\.genealogy-detail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.genealogy-detail-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
});

test("l'export v5 est raccordé et une archive v5 restaure uniquement en prévisualisation", () => {
  assert.match(app, /createBackupArchiveManifest\(\{/);
  assert.match(app, /generateBackupZip\(archive, JSZip/);
  assert.match(app, /if \(archiveVersion === BACKUP_ARCHIVE_VERSION\)/);
  assert.match(app, /prepareBackupRestorePlan\(archive\.manifest/);
  assert.match(app, /aucune écriture ne sera exécutée depuis cette interface/i);
});
