import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  TRANSCRIPTION_DRAFT_REMOTE_COLLECTION,
  TRANSCRIPTION_DRAFT_REMOTE_VERSION,
  TRANSCRIPTION_DRAFT_SYNC_DELAY_MS,
  TRANSCRIPTION_DRAFT_SYNC_LABELS,
  TRANSCRIPTION_DRAFT_CONFLICT_LABELS,
  validateTranscriptionDraftTarget,
  transcriptionDraftRemoteKey,
  transcriptionDraftNowIso,
  transcriptionDraftSnapshotsEqual,
  transcriptionDraftSnapshotFromDraft,
  parseTranscriptionDraftRemoteData,
  buildTranscriptionDraftRemotePayload,
  reconcileTranscriptionDraftOnOpen,
  planTranscriptionDraftWrite,
  transcriptionDraftSnapshotPreview
} from "../js/transcription-draft-sync.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const syncSource = readFileSync(resolve(ROOT, "js/transcription-draft-sync.js"), "utf8");
const appSource = readFileSync(resolve(ROOT, "js/app.js"), "utf8");
const rulesSource = readFileSync(resolve(ROOT, "firestore.rules"), "utf8");
const htmlSource = readFileSync(resolve(ROOT, "index.html"), "utf8");

const TARGET = { ownerUid: "user-1", documentId: "doc-1", pageId: "page-1" };

function snapshotFixture(overrides = {}) {
  return {
    documentId: "doc-1",
    pageId: "page-1",
    original: [{ id: "p-1", textIt: "Anno 1891", translationFr: "L’année 1891" }],
    passages: [{ id: "p-1", textIt: "Anno 1891", translationFr: "L’année 1891" }],
    createdIds: [],
    selectedPassageId: "p-1",
    ...overrides
  };
}

function remoteFixture(overrides = {}) {
  return buildTranscriptionDraftRemotePayload({
    target: TARGET,
    snapshot: snapshotFixture(),
    version: 1,
    createdAt: "2026-10-31T10:00:00.000Z",
    updatedAt: "2026-10-31T10:00:00.000Z",
    ...overrides
  });
}

test("cible distante validée : identifiants requis, jamais de séparateur de chemin", () => {
  assert.deepEqual(validateTranscriptionDraftTarget(TARGET), TARGET);
  assert.throws(() => validateTranscriptionDraftTarget({ ownerUid: "", documentId: "d", pageId: "p" }), TypeError);
  assert.throws(() => validateTranscriptionDraftTarget({ ownerUid: "u", documentId: " ", pageId: "p" }), TypeError);
  assert.throws(() => validateTranscriptionDraftTarget({ ownerUid: "u", documentId: "d/p", pageId: "p" }), TypeError);
  assert.throws(() => validateTranscriptionDraftTarget({ ownerUid: "u", documentId: "d" }), TypeError);
  assert.equal(transcriptionDraftRemoteKey(TARGET), "transcriptionDrafts|user-1|doc-1|page-1");
  assert.notEqual(
    transcriptionDraftRemoteKey({ ownerUid: "a|b", documentId: "c", pageId: "d" }),
    transcriptionDraftRemoteKey({ ownerUid: "a", documentId: "b|c", pageId: "d" }),
    "segments encodés : aucune collision de clé"
  );
});

test("constantes du lot : collection privée, délai ~5 s, versions strictes, libellés français", () => {
  assert.equal(TRANSCRIPTION_DRAFT_REMOTE_COLLECTION, "transcriptionDrafts");
  assert.equal(TRANSCRIPTION_DRAFT_REMOTE_VERSION, 1);
  assert.equal(TRANSCRIPTION_DRAFT_SYNC_DELAY_MS, 5000, "synchronisation différée d'environ 5 secondes");
  assert.equal(TRANSCRIPTION_DRAFT_SYNC_LABELS.syncing, "Synchronisation en cours…");
  assert.equal(TRANSCRIPTION_DRAFT_SYNC_LABELS.synced, "Synchronisé entre appareils");
  assert.equal(TRANSCRIPTION_DRAFT_SYNC_LABELS.offline, "Synchronisation impossible");
  assert.equal(TRANSCRIPTION_DRAFT_SYNC_LABELS.conflict, "Conflit à résoudre");
  assert.equal(TRANSCRIPTION_DRAFT_CONFLICT_LABELS.local, "Version de cet appareil");
  assert.equal(TRANSCRIPTION_DRAFT_CONFLICT_LABELS.remote, "Version distante");
  /* Le module reste pur : aucun import, ni stockage, ni fenêtre. */
  assert.doesNotMatch(syncSource, /\bfrom\s+["']/, "aucun import externe");
  assert.doesNotMatch(syncSource, /localStorage|window\./, "ni stockage ni fenêtre : décisions seulement");
});

test("comparaison de snapshots : indépendante de l'ordre des clés, sensible au contenu", () => {
  const left = snapshotFixture();
  const right = JSON.parse(JSON.stringify(snapshotFixture()));
  assert.equal(transcriptionDraftSnapshotsEqual(left, right), true);
  const reordered = { selectedPassageId: left.selectedPassageId, pageId: left.pageId, createdIds: left.createdIds, passages: left.passages, original: left.original, documentId: left.documentId };
  assert.equal(transcriptionDraftSnapshotsEqual(left, reordered), true, "ordre des clés sans effet");
  const changed = snapshotFixture();
  changed.passages[0].textIt = "Anno 1892";
  assert.equal(transcriptionDraftSnapshotsEqual(left, changed), false, "contenu modifié détecté");
  assert.equal(transcriptionDraftSnapshotsEqual(left, null), false);
});

test("snapshot de synchronisation : contenu seul, brouillon propre = null", () => {
  const draft = { documentId: "doc-1", pageId: "page-1", dirty: true, original: [], passages: [{ id: "p" }], createdIds: [], selectedPassageId: "p", translationReview: ["p"] };
  const snapshot = transcriptionDraftSnapshotFromDraft(draft);
  assert.equal(snapshot.documentId, "doc-1");
  assert.deepEqual(snapshot.passages, [{ id: "p" }]);
  assert.equal("translationReview" in snapshot, false, "aucun état d'interface dans le payload");
  const clean = transcriptionDraftSnapshotFromDraft({ ...draft, dirty: false });
  assert.equal(clean, null, "brouillon propre : rien à synchroniser");
  assert.throws(() => transcriptionDraftSnapshotFromDraft(null), TypeError);
});

test("lecture d'un distant : structure hétérogène rejetée, jamais interprétée", () => {
  const valid = remoteFixture();
  const parsed = parseTranscriptionDraftRemoteData(valid, TARGET);
  assert.equal(parsed.version, 1);
  assert.equal(parseTranscriptionDraftRemoteData(valid, { ...TARGET, pageId: "autre" }), null, "autre page refusée");
  assert.equal(parseTranscriptionDraftRemoteData(valid, { ...TARGET, ownerUid: "user-2" }), null, "autre propriétaire refusé");
  assert.equal(parseTranscriptionDraftRemoteData({ ...valid, version: 0 }, TARGET), null, "version invalide");
  assert.equal(parseTranscriptionDraftRemoteData({ ...valid, version: "1" }, TARGET), null, "version non entière refusée");
  assert.equal(parseTranscriptionDraftRemoteData({ ...valid, updatedBy: "" }, TARGET), null);
  assert.equal(parseTranscriptionDraftRemoteData({ ...valid, snapshot: { documentId: "doc-1", pageId: "page-1" } }, TARGET), null, "snapshot tronqué refusé");
  assert.equal(parseTranscriptionDraftRemoteData(null, TARGET), null);
  assert.equal(parseTranscriptionDraftRemoteData([valid], TARGET), null);
});

test("payload distant : construit avec les six champs de synchronisation", () => {
  const payload = remoteFixture();
  assert.deepEqual(Object.keys(payload).sort(), ["createdAt", "documentId", "ownerUid", "pageId", "snapshot", "updatedAt", "updatedBy", "version"]);
  assert.equal(payload.updatedBy, "user-1", "écrivain = propriétaire");
  assert.ok(payload.snapshot.passages.length === 1);
  assert.throws(() => buildTranscriptionDraftRemotePayload({ target: TARGET, snapshot: null, version: 1, createdAt: "a", updatedAt: "b" }), TypeError);
  assert.throws(() => buildTranscriptionDraftRemotePayload({ target: TARGET, snapshot: snapshotFixture(), version: 0, createdAt: "a", updatedAt: "b" }), TypeError);
  assert.match(transcriptionDraftNowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/, "horodatage ISO de 24 caractères");
});

test("réconciliation à l'ouverture : migration non destructive, restauration, conflit explicite", () => {
  const remote = remoteFixture();
  assert.deepEqual(reconcileTranscriptionDraftOnOpen({ localSnapshot: null, remote: null }), { operation: "none" });
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: snapshotFixture(), remote: null }),
    { operation: "push" },
    "aucun distant : migration du local"
  );
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: null, remote }),
    { operation: "restore" },
    "distant sans local : chargement"
  );
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: snapshotFixture(), remote }),
    { operation: "confirm" },
    "contenus identiques : confirmation sans écriture"
  );
  const divergent = remoteFixture();
  divergent.snapshot.passages[0].textIt = "Anno millenovecentoventi";
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: snapshotFixture(), remote: divergent }),
    { operation: "conflict" },
    "contenus différents : jamais d'écrasement automatique"
  );
});

test("scénarios 1-2 : une suppression distante n'est jamais republiée silencieusement", () => {
  const remote = remoteFixture();
  /* Suppression observée (distant absent alors que la version était connue) :
     conflit explicite à l'ouverture ET à l'écriture — jamais de republiage. */
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: snapshotFixture(), remote: null, baseVersion: 3 }),
    { operation: "conflict" },
    "ouverture : version connue supprimée à distance = conflit"
  );
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote: null, baseVersion: 3 }),
    { operation: "conflict" },
    "écriture : aucune création automatique après suppression observée"
  );
  /* Migration restée possible : aucune référence connue = premier transfert. */
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: snapshotFixture(), remote: null, baseVersion: null }),
    { operation: "push" },
    "aucune référence connue : migration du local maintenue"
  );
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote: null, baseVersion: null }),
    { operation: "create", version: 1 },
    "première publication : création en version 1"
  );
  /* Sans contenu local, une suppression ne provoque rien (jamais de push vide). */
  assert.deepEqual(
    reconcileTranscriptionDraftOnOpen({ localSnapshot: null, remote: null, baseVersion: 3 }),
    { operation: "none" },
    "aucun local : rien à republier même si une version était connue"
  );
  /* La suppression elle-même reste planifiée seulement sur version connue
     (rappel : la purge automatique n'a jamais lieu sans référence). */
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote, baseVersion: 1 }), { operation: "delete" }, "version de référence correspondante : purge autorisée");
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote, baseVersion: 2 }), { operation: "conflict" }, "purge d'une version dépassée refusée");
});

test("plan d'écriture : versions strictement croissantes, aucune date prise pour décision", () => {
  const remote = remoteFixture();
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote: null, baseVersion: null }), { operation: "create", version: 1 });
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote, baseVersion: 1 }),
    { operation: "update", version: 2 },
    "base connue à jour : +1 strict"
  );
  const newer = remoteFixture();
  newer.version = 4;
  newer.snapshot = JSON.parse(JSON.stringify(snapshotFixture()));
  newer.snapshot.passages[0].textIt = "Texte modifié sur un autre appareil";
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote: newer, baseVersion: 1 }),
    { operation: "conflict" },
    "distant dépassé : conflit, jamais d'écrasement"
  );
  const divergent = remoteFixture();
  divergent.snapshot = JSON.parse(JSON.stringify(snapshotFixture()));
  divergent.snapshot.passages[0].textIt = "Texte d’un autre appareil";
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote: divergent, baseVersion: null }),
    { operation: "conflict" },
    "base inconnue et contenu différent : conflit"
  );
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote, baseVersion: null }),
    { operation: "adopt", version: 1 },
    "base inconnue mais contenu identique : simple adoption"
  );
  assert.deepEqual(
    planTranscriptionDraftWrite({ localSnapshot: snapshotFixture(), remote, baseVersion: null }),
    { operation: "adopt", version: 1 },
    "contenu déjà distant : simple adoption de la version"
  );
  /* Nettoyage : seulement avec une référence connue et correspondante. */
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote, baseVersion: 1 }), { operation: "delete" });
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote: null, baseVersion: null }), { operation: "none" });
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote, baseVersion: null }), { operation: "none" }, "jamais de purge sans référence");
  assert.deepEqual(planTranscriptionDraftWrite({ localSnapshot: null, remote, baseVersion: 3 }), { operation: "conflict" }, "purge d'une version dépassée refusée");
  /* Le plan ne porte aucune décision basée sur l'horodatage : aucune date n'y figure. */
  const planText = syncSource.match(/export function planTranscriptionDraftWrite[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(planText, /updatedAt|Date\(|getTime/, "aucune date dans la décision d'écriture");
});

test("aperçu de conflit : les deux versions lisibles, jamais fusionnées", () => {
  const preview = transcriptionDraftSnapshotPreview(snapshotFixture());
  assert.match(preview, /Passage 1 \(l\. 1\)|Passage 1 :/);
  assert.match(preview, /Anno 1891/);
  assert.match(preview, /Traduction : L’année 1891/);
  const empty = transcriptionDraftSnapshotPreview(snapshotFixture({ passages: [] }));
  assert.equal(empty, "(aucun passage)");
  const long = transcriptionDraftSnapshotPreview(snapshotFixture({ passages: [{ id: "p", textIt: "x".repeat(100) }] }), { maxChars: 20 });
  assert.equal(long.length, 21, "troncature explicite avec ellipsis");
  assert.equal(transcriptionDraftSnapshotPreview(null), "");
});

test("périmètre applicatif : branchement distant reporté à l'application, règles préparées", () => {
  /* L'application porte l'accès Firestore, pas le module pur. */
  assert.match(appSource, /from "\.\/transcription-draft-sync\.js"/, "module pur importé par l'application");
  assert.match(appSource, /TRANSCRIPTION_DRAFT_SYNC_DELAY_MS/, "délai de 5 s branché côté application");
  assert.match(appSource, /runTransaction/, "écriture atomique via transaction Firestore");
  assert.match(appSource, /transcriptionDraftConflictDialog/, "interface de résolution des conflits raccordée");
  /* Règles préparées localement : collection explicitement restreinte. */
  assert.match(rulesSource, /match \/transcriptionDrafts\/\{ownerUid\}/, "règles de la collection préparées");
  assert.match(rulesSource, /request\.auth\.uid == ownerUid/, "propriétaire authentifié seulement");
  assert.match(rulesSource, /request\.resource\.data\.version == resource\.data\.version \+ 1/, "incrémentation de version vérifiée côté base");
  /* Aucune permission élargie sur les collections existantes : le garde-fou
     « aucun autre document exposé » reste en dernier recours. */
  assert.match(rulesSource, /match \/\{document=\*\*\} \{\s*\r?\n\s*allow read, write: if false;/, "garde-fou final intact");
  /* Balises d'interface présentes. */
  assert.match(htmlSource, /id="transcriptionDraftConflictDialog"/, "dialog de conflit dans le balisage");
  assert.match(htmlSource, /id="transcriptionDraftRecoveryDialog"/, "dialog de reprise d'un brouillon hérité dans le balisage");
  assert.match(htmlSource, /id="workshopConflictBtn"/, "réouverture du conflit en pied d'atelier");
  assert.match(htmlSource, /id="workshopSaveStatus" role="status">Brouillon local</, "statut local inchangé");
  /* Reprise des brouillons hérités : offerte explicitement, jamais automatique. */
  assert.match(appSource, /function offerTranscriptionDraftLegacyRecovery\(/, "offre de reprise dédiée dans l'application");
  assert.match(appSource, /markTranscriptionDraftLegacyRecoveryHandled\(target\.ownerUid, target\.documentId, target\.pageId\)/, "choix explicite marqué, sans jamais supprimer l'hérité");
  assert.match(appSource, /readTranscriptionDraft\(storage, target\.documentId, target\.pageId\)/, "relecture de l'espace hérité seulement, jamais d'écriture en face");
});
