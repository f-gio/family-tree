import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  BACKUP_ARCHIVE_VERSION,
  BACKUP_COLLECTION_NAMES,
  adaptLegacyV4Archive,
  createBackupArchiveManifest,
  prepareBackupRestorePlan,
  verifyBackupArchive
} from "../js/backup-archive.js";

const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

/* Jeu complet au sens des collections requises : la présence des clés (même
   vides) distingue une collection légitimement vide d'une collection absente. */
function fullCollections(overrides = {}) {
  return {
    people: [], families: [], trees: [], documents: [], tasks: [],
    sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
    genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [],
    genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [],
    factHypotheses: [], factHypothesisRevisions: [],
    ...overrides
  };
}

const consistentCapture = { consistent: true, changeDetected: false, strategy: "double-read-client-no-global-firestore-transaction" };

test("les deux collections d'hypothèses sont exigées pour une sauvegarde complète", async () => {
  assert.ok(BACKUP_COLLECTION_NAMES.includes("factHypotheses"));
  assert.ok(BACKUP_COLLECTION_NAMES.includes("factHypothesisRevisions"));

  const { manifest } = await createBackupArchiveManifest({ collections: fullCollections(), capture: consistentCapture });
  assert.equal(manifest.completeness.status, "complete");
  assert.deepEqual(manifest.completeness.missingCollections, []);
  assert.equal(BACKUP_ARCHIVE_VERSION, 5);
});

test("une collection vide est légitime, une collection absente rend l'archive partielle", async () => {
  const absent = fullCollections();
  delete absent.factHypotheses;
  delete absent.factHypothesisRevisions;
  const partial = await createBackupArchiveManifest({ collections: absent, capture: consistentCapture });
  assert.equal(partial.manifest.completeness.status, "partial");
  assert.ok(partial.manifest.completeness.missingCollections.includes("factHypotheses"));
  assert.ok(partial.manifest.completeness.missingCollections.includes("factHypothesisRevisions"));
  const warning = partial.manifest.completeness.warnings.find(item => item.code === "COLLECTIONS_MISSING");
  assert.match(warning.message, /factHypotheses, factHypothesisRevisions/);

  const emptyButPresent = await createBackupArchiveManifest({
    collections: fullCollections({ factHypotheses: [], factHypothesisRevisions: [] }), capture: consistentCapture
  });
  assert.equal(emptyButPresent.manifest.completeness.status, "complete", "tableau vide présent ≠ collection absente");
  assert.deepEqual(emptyButPresent.manifest.completeness.missingCollections, []);
});

test("une capture non atomique reste partielle même avec les hypothèses présentes", async () => {
  const { manifest } = await createBackupArchiveManifest({
    collections: fullCollections(), capture: { consistent: false, strategy: "client-multi-read" }
  });
  assert.equal(manifest.completeness.status, "partial");
  assert.ok(manifest.completeness.warnings.some(item => item.code === "SNAPSHOT_NOT_ATOMIC"));
});

test("révisions, personnes, ancre et attestations manquantes sont signalées", async () => {
  const { manifest } = await createBackupArchiveManifest({
    collections: fullCollections({
      people: [{ id: "p1", lastName: "Rossi", retainedHypothesis: { "birth.date": "h-missing" } }],
      factHypotheses: [
        {
          id: "h1", personId: "p1", fieldKey: "birth.date", status: "alternative",
          value: { type: "year", year: 1869 }, currentRevisionId: "rev-absente",
          attestations: [{ attestationId: "att-absente", role: "supports" }]
        },
        { id: "h2", personId: "p-absent", fieldKey: "birth.date", status: "alternative", value: { type: "year", year: 1870 } }
      ]
    }),
    capture: consistentCapture
  });
  const errors = manifest.integrity.errors;
  assert.equal(manifest.completeness.status, "partial");
  assert.ok(errors.some(item => item.code === "REVISION_MISSING" && item.reference === "rev-absente"), "hypothèse sans révision");
  assert.ok(errors.some(item => item.code === "REFERENCE_MISSING" && item.reference === "p-absent"), "hypothèse sans personne");
  assert.ok(errors.some(item => item.code === "REFERENCE_MISSING" && item.reference === "att-absente"), "attestation absente");
  assert.ok(errors.some(item => item.code === "REFERENCE_MISSING" && item.reference === "h-missing"), "ancre incohérente");
  const verification = await verifyBackupArchive(manifest, new Map());
  assert.equal(verification.valid, false);
});

test("une révision orpheline est signalée dans l'intégrité", async () => {
  const { manifest } = await createBackupArchiveManifest({
    collections: fullCollections({
      factHypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "alternative", value: { type: "year", year: 1869 }, currentRevisionId: "h1-r1" }],
      factHypothesisRevisions: [{ id: "rev-x", objectId: "h-autre", personId: "p1", fieldKey: "birth.date", operation: "created" }]
    }),
    capture: consistentCapture
  });
  assert.ok(manifest.integrity.errors.some(item => item.code === "REFERENCE_MISSING" && item.reference === "h-autre"), "révision sans hypothèse");
  assert.equal(manifest.completeness.status, "partial");
});

test("une archive v4 historique reste lisible et ne fabrique pas d'hypothèses", async () => {
  const legacy = {
    format: "family-tree-backup",
    version: 4,
    exportedAt: "2026-01-01T00:00:00.000Z",
    people: [], families: [], trees: [], tasks: [], documents: []
  };
  const adapted = await adaptLegacyV4Archive(legacy, new Map());
  assert.equal(adapted.completeness.status, "partial");
  assert.ok(adapted.completeness.missingCollections.includes("factHypotheses"));
  assert.equal(adapted.collections.factHypotheses, undefined, "aucune collection inventée");
  assert.equal(adapted.collections.factHypothesisRevisions, undefined);
  assert.equal(adapted.version, BACKUP_ARCHIVE_VERSION);
});

test("le plan de restauration bloque les conflits d'hypothèses sans jamais supprimer", async () => {
  const { manifest } = await createBackupArchiveManifest({
    collections: fullCollections({
      factHypotheses: [{ id: "h1", personId: "p1", fieldKey: "birth.date", status: "retained", value: { type: "year", year: 1869 } }]
    }),
    capture: consistentCapture
  });

  const blocked = prepareBackupRestorePlan(manifest, {
    existing: { factHypotheses: ["h1"] }, conflictPolicy: "abort", allowIncomplete: true, activeUserIds: ["u1"]
  });
  assert.equal(blocked.blocked, true, "conflit d'identifiant d'hypothèse bloqué avant toute écriture");
  assert.ok(blocked.conflicts.some(item => item.collection === "factHypotheses" && item.id === "h1"));
  assert.equal(blocked.writesPerformed, false);
  assert.equal(blocked.kind, "read-only-restore-plan");

  const kept = prepareBackupRestorePlan(manifest, {
    existing: { factHypotheses: ["h1"] }, conflictPolicy: "keep-existing", allowIncomplete: true, activeUserIds: ["u1"]
  });
  assert.equal(kept.blocked, false);
  assert.equal(kept.operations.find(item => item.collection === "factHypotheses").action, "skip");

  /* Archive ancienne sans collections : aucune opération, aucune suppression. */
  const absent = fullCollections();
  delete absent.factHypotheses;
  delete absent.factHypothesisRevisions;
  const oldManifest = (await createBackupArchiveManifest({ collections: absent, capture: consistentCapture })).manifest;
  const legacyPlan = prepareBackupRestorePlan(oldManifest, {
    existing: { factHypotheses: ["h-existant"], factHypothesisRevisions: ["r-existante"] }, allowIncomplete: true, activeUserIds: ["u1"]
  });
  assert.equal(legacyPlan.operations.some(item => String(item.collection).startsWith("factHypothesis")), false);
  assert.equal(legacyPlan.operations.some(item => item.action === "delete" || item.action === "remove"), false, "jamais de suppression d'hypothèses existantes");
  assert.equal(legacyPlan.blocked, false);
});

test("l'export signale explicitement l'inaccessibilité des hypothèses", () => {
  /* Permission refusée : échec nommé, jamais une collection interprétée comme vide. */
  assert.match(app, /Sauvegarde interrompue : la collection \$\{name\} est inaccessible/);
  assert.match(app, /permission-denied"\s*\?\s*"règles Firestore des hypothèses non publiées ou accès refusé"/);
  assert.match(app, /Aucune archive n’a été produite/);
  /* Capture conditionnelle à l'état « prêt » : sinon manifeste partiel. */
  assert.match(app, /if \(factHypothesesAvailable\(\)\) names\.push\("factHypotheses", "factHypothesisRevisions"\)/);
  /* La restauration v4 n'écrit ni n'efface jamais ces collections. */
  assert.doesNotMatch(app, /writeImportedRecords\("factHypotheses"/);
  assert.doesNotMatch(app, /deleteDoc\(doc\(db, "factHypotheses"/);
  assert.doesNotMatch(app, /deleteDoc\(doc\(db, "factHypothesisRevisions"/);
  /* Prévisualisation : état courant, conflits d'incohérence et avertissement
     lorsque les règles des hypothèses ne sont pas publiées. */
  assert.match(app, /current\.factHypotheses = factHypotheses\.map\(item => item\.id\)/);
  assert.match(app, /FACT_HYPOTHESES_RULES_UNAVAILABLE/);
  assert.match(app, /detectFactHypothesisConflicts\(\{ peopleRecords: people, hypotheses: factHypotheses \}\)/);
  assert.match(app, /Prévisualisation uniquement/);
});
