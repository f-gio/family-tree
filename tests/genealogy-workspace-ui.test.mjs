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
  assert.match(app, /onSnapshot\(refs\[collectionName\]/);
  assert.match(app, /query\(target, where\("authorUid", "==", auth\.currentUser\?\.uid/);
  assert.match(app, /query\(refs\.genealogyNotifications, where\("recipientUid", "==", auth\.currentUser\?\.uid/);
});

test("propositions, décisions, révisions et réexamens passent par le magasin sécurisé du lot 6", () => {
  for (const operation of ["createProposal", "submitProposal", "cancelDraft", "decideProposal", "createOfficial", "reviseOfficial", "createReexaminationEvent", "markNotificationRead"]) {
    assert.ok(app.includes(`genealogyStore.${operation}(`), `opération du magasin absente : ${operation}`);
  }
  assert.match(app, /hidden = !isAdminUser\(\)/);
  assert.match(app, /data-genealogy-proposal-action="accept"/);
  assert.match(app, /data-genealogy-review=/);
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
