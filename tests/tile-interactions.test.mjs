import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [app, css] = await Promise.all([
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8")
]);

test("Annuaire : la tuile ouvre la fiche, le menu conserve le compteur de documents", () => {
  const render = app.slice(app.indexOf("function renderDirectory()"), app.indexOf("function renderDirectoryChips", app.indexOf("function renderDirectory()")));
  assert.match(render, /data-directory-person="\$\{item\.id\}" data-primary-tile tabindex="0" role="group"/);
  assert.match(render, /data-directory-documents="\$\{item\.id\}"/);
  assert.match(render, /directory-entry-documents">\$\{documentAction\}<\/div><div class="directory-entry-menu">\$\{menu\}/);
  assert.match(render, /tileContextMenuMarkup\("directory", item\.id[\s\S]*?label: "Supprimer"/);
  assert.doesNotMatch(render, /directory-open-action|>→</);
  assert.match(app, /preparePrimaryTileActivation\(event, entry, \$\("personDialog"\)\);\s*openPerson/);
});

test("Documents : les personnes restent affichées et seules les pièces consultables ouvrent le visualiseur", () => {
  const render = app.slice(app.indexOf("function renderDocuments()"), app.indexOf("async function optimizeFile", app.indexOf("function renderDocuments()")));
  assert.match(render, /const canOpen = !!\(item\.chunkCount \|\| item\.fileData \|\| item\.fileUrl \|\| item\.externalUrl\);/);
  assert.match(render, /data-primary-tile data-document-openable="true" tabindex="0" role="group"/);
  assert.match(render, /document-card-people/);
  assert.match(render, /tileContextMenuMarkup\("document", item\.id[\s\S]*?label: "Modifier"[\s\S]*?label: "Supprimer"/);
  assert.match(app, /removeDocument\(id = \$\("documentId"\)\.value\)/);
  assert.match(app, /openStoredDocument\(item\);/);
});

test("Démarches : la fiche s'ouvre par activation principale, sans suppression risquée du dossier", () => {
  const render = app.slice(app.indexOf("function procedureCard(item)"), app.indexOf("function renderProcedures()", app.indexOf("function procedureCard(item)")));
  assert.match(render, /class="procedure-item" tabindex="0" role="group" data-primary-tile data-procedure-card=/);
  assert.match(render, /tileContextMenuMarkup\("procedure", item\.id[\s\S]*?key: "edit", label: "Modifier"/);
  assert.doesNotMatch(render, /key: "delete"|data-remove-dossier|procedure-open-btn|>Consulter</);
  assert.match(app, /if \(kind === "procedure" && action === "edit"\)[\s\S]*?openDossierForm\(item\)/);
  assert.match(app, /preparePrimaryTileActivation\(event, tile, \$\("procedureDetailDialog"\)\);\s*openProcedureDetail\(tile\.dataset\.procedureCard\)/);
  assert.match(app, /if \(!tile \|\| event\.target !== tile \|\| !\["Enter", " "\]\.includes\(event\.key\)\) return;/);
  const deleteDossier = app.slice(app.indexOf("async function removeDossier()"), app.indexOf("function openUnknownDossier", app.indexOf("async function removeDossier()")));
  assert.match(deleteDossier, /deleteDoc\(doc\(db, "procedures", id\)\)/);
  assert.doesNotMatch(deleteDossier, /collection\(db, "procedures", id, "actions"\)|writeBatch/);
});

test("Actions : menu secondaire aligné à la fenêtre malgré content-visibility des cartes", () => {
  assert.match(app, /group\.closest\("\.directory-entry, \.content-card"\)\?\.classList\.add\("tile-context-open"\)/);
  assert.match(app, /const maxTop = Math\.max\(8, viewportHeight - bounds\.height - 8\);/);
  assert.match(css, /\.directory-entry\.tile-context-open,[\s\S]*?\.content-card\.tile-context-open \{ content-visibility: visible; \}/);
});
