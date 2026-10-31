import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";
import {
  planTranscriptionDraftWrite,
  buildTranscriptionDraftRemotePayload,
  parseTranscriptionDraftRemoteData,
  transcriptionDraftNowIso
} from "../js/transcription-draft-sync.js";

/* Synchronisation des brouillons entre appareils (lot 2B.2, incrément 2).

   Harnais : le « serveur » distant vit dans le processus Node (plan, payload
   et validation réutilisent le module pur exactement comme la production) et
   est exposé aux pages par context.exposeFunction — chaque page possède son
   propre contexte Playwright donc son propre localStorage : deux appareils
   réellement isolés partageant le même compte. Aucune écriture Firestore
   réelle ; window.__transcriptionDraftRemoteBackend détourne intégralement la
   couche applicative. L'écriture distante est retardée de 200 ms côté page
   pour rendre observable l'état « Synchronisation en cours… ». */

const LOCAL_DRAFT_PREFIX = "familyTreeTranscriptionDraft:";

const REMOTE_TEST_SVG = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');

const REMOTE_TEST_HOOKS = `
window.__draftRemote = {
  clearLocalDrafts() {
    const keys = [];
    for (let index = 0; index < localStorage.length; index++) keys.push(localStorage.key(index));
    for (const key of keys) {
      if (key && (key.startsWith("${LOCAL_DRAFT_PREFIX}") || key.startsWith("familyTreeTranscriptionDraftRemote:") || key.startsWith("familyTreeTranscriptionDraftRecovery:"))) localStorage.removeItem(key);
    }
  },
  legacyKey() { return "familyTreeTranscriptionDraft:doc-remote|page-remote-1"; },
  ownedKeyOf(uid) { return "familyTreeTranscriptionDraft:" + encodeURIComponent(uid) + "|doc-remote|page-remote-1"; },
  recoveryFlagOf(uid) { return "familyTreeTranscriptionDraftRecovery:" + encodeURIComponent(uid) + "|doc-remote|page-remote-1"; },
  /* Enregistrement hérité (avant la synchronisation entre appareils) : format
     historique sans propriétaire, contenu différent de l'officiel (sale). */
  seedLegacyDraft() {
    const passage = (id, order, textIt, translationFr, lineLabel, translationState) =>
      ({ id, order, textIt, translationFr, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel, translationState });
    const record = {
      v: 1,
      documentId: "doc-remote",
      pageId: "page-remote-1",
      savedAt: "2026-10-01T09:00:00.000Z",
      snapshot: {
        documentId: "doc-remote",
        pageId: "page-remote-1",
        original: [
          passage("p-1", 0, "Anno millenovecento", "L’année mille neuf cent", "l. 1", "current"),
          passage("p-2", 1, "indici di Orino", null, "l. 2", "not-started")
        ],
        passages: [
          passage("p-1", 0, "Anno del testamento ereditato", "L’année du testament hérité", "l. 1", "current"),
          passage("p-2", 1, "indici di Orino", null, "l. 2", "not-started")
        ],
        createdIds: [],
        selectedPassageId: "p-1"
      }
    };
    localStorage.setItem(this.legacyKey(), JSON.stringify(record));
    localStorage.removeItem(this.recoveryFlagOf(window.__draftRemoteUid || "compte-remote-1"));
  },
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed() {
    const documentItem = {
      id: "doc-remote", title: "Registre Transactions Immobilières",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEQAD8kf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIDAT8kf//Z",
      personIds: [],
      pages: [{ id: "page-remote-1", label: "Folio 1", photographs: [{ id: "photo-remote-1", preview: { dataUrl: "${REMOTE_TEST_SVG}" } }],
        passages: [
          { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 1", translationState: "current" },
          { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" }
        ]
      }]
    };
    documents = [documentItem];
    people = [];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin" };
    renderGenealogyWorkspace();
  },
  openDoc() { setView("directory"); openStoredDocument(documents[0], "directory"); },
  transcribe() { const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (button) button.click(); },
  badge() { return $("workshopSaveStatus").textContent; },
  fieldValue() { return document.querySelector('[data-workshop-field="textIt"]')?.value || ""; }
};

/* Compte connecté simulé + backend distant branché sur le serveur Node. */
transcriptionDraftSyncOwnerUid = () => window.__draftRemoteUid || null;
window.__draftRemoteUid = "compte-remote-1";

window.__transcriptionDraftRemoteBackend = {
  async read(target) {
    const response = await window.__draftRemoteServerRead(transcriptionDraftRemoteKey(target), JSON.stringify(target));
    if (!response.ok) throw new Error(response.error);
    return response.remote;
  },
  async write(target, localSnapshot, baseVersion) {
    const response = await window.__draftRemoteServerWrite(transcriptionDraftRemoteKey(target), JSON.stringify(target), localSnapshot, baseVersion);
    if (!response.ok) throw new Error(response.error);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { outcome: response.outcome, remote: response.remote };
  }
};
`;

/* L'authentification Firebase est bloquée hors ligne dans le harnais : sans
   neutralisation, le callback différé ferme la page via stopPrivateData —
   patch de test seulement, jamais dans l'application. */
const REMOTE_AUTH_PATCH = `
const originalStopPrivateData = stopPrivateData;
stopPrivateData = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalStopPrivateData(...args); };
const originalShowAuthPanel = showAuthPanel;
showAuthPanel = (...args) => { if (window.__ignoreAuthBootstrap) return; return originalShowAuthPanel(...args); };
const originalCloseDocumentPage = closeDocumentPage;
closeDocumentPage = (...args) => {
  if (window.__ignoreAuthBootstrap && String(new Error().stack || "").includes("firebase-auth")) return;
  return originalCloseDocumentPage(...args);
};
window.__ignoreAuthBootstrap = true;
`;

async function openRemoteHarness(t) {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const server = await startStaticServer(ROOT);
  const serverState = { entries: {}, offline: false };
  const hooks = `${REMOTE_TEST_HOOKS}\n${REMOTE_AUTH_PATCH}`;
  const contexts = [];
  const pageErrors = [];

  /* Chaque appareil = un contexte Playwright (localStorage isolé, comme deux
     navigateurs réels) partageant le même serveur Node. */
  async function createDevice({ uid = "compte-remote-1" } = {}) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    contexts.push(context);
    await context.exposeFunction("__draftRemoteServerRead", (key, targetJson) => {
      if (serverState.offline) return { ok: false, error: "réseau indisponible" };
      const raw = serverState.entries[key];
      if (!raw) return { ok: true, remote: null };
      return { ok: true, remote: parseTranscriptionDraftRemoteData(raw, JSON.parse(targetJson)) };
    });
    await context.exposeFunction("__draftRemoteServerWrite", (key, targetJson, localSnapshot, baseVersion) => {
      if (serverState.offline) return { ok: false, error: "réseau indisponible" };
      const target = JSON.parse(targetJson);
      const raw = serverState.entries[key] || null;
      const remote = raw ? parseTranscriptionDraftRemoteData(raw, target) : null;
      const plan = planTranscriptionDraftWrite({ localSnapshot, remote, baseVersion });
      if (plan.operation === "conflict") return { ok: true, outcome: "conflict", remote };
      if (plan.operation === "adopt" || plan.operation === "none") return { ok: true, outcome: "synced", remote };
      if (plan.operation === "delete") {
        delete serverState.entries[key];
        return { ok: true, outcome: "synced", remote: null };
      }
      const now = transcriptionDraftNowIso();
      const payload = buildTranscriptionDraftRemotePayload({
        target,
        snapshot: localSnapshot,
        version: plan.version,
        createdAt: plan.operation === "update" && remote ? remote.createdAt : now,
        updatedAt: now
      });
      serverState.entries[key] = payload;
      return { ok: true, outcome: "synced", remote: payload };
    });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (new URL(url).pathname.endsWith("/js/app.js")) {
        const response = await route.fetch();
        return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
      }
      return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.on("pageerror", error => pageErrors.push(error.message));
    page.on("dialog", async dialog => { await dialog.accept(); });
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__draftRemote === "object");
    await page.evaluate(deviceUid => {
      window.__draftRemoteUid = deviceUid;
      window.__draftRemote.show();
      window.__draftRemote.seed();
    }, uid);
    return page;
  }

  return { browser, server, serverState, contexts, pageErrors, createDevice };
}

async function openWorkshopOn(page) {
  await page.evaluate(() => { window.__draftRemote.openDoc(); window.__draftRemote.transcribe(); });
  await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
}

async function exitWorkshop(page) {
  await page.click("#workshopBackBtn");
  await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden);
}

function serverKey() {
  return "transcriptionDrafts|compte-remote-1|doc-remote|page-remote-1";
}

function assertNoWorkshopPageErrors(pageErrors) {
  const relevant = pageErrors.filter(message => /transcriptionDraft|workshop|resolveTranscription|syncTranscription/i.test(message));
  assert.deepEqual(relevant, [], `aucune erreur applicative liée à la synchronisation (${relevant.join(" | ")})`);
}

/* Attente côté Node (le « serveur » simulé vit dans ce processus). */
async function waitForRemote(description, predicate, timeout = 9000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Condition distante non atteinte : ${description}`);
}

test("brouillons synchronisés : migration de l'ordinateur, délai ~5 s et reprise sur le mobile", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const page = await createDevice();
    await openWorkshopOn(page);
    assert.equal(await page.evaluate(() => window.__draftRemote.badge()), "Brouillon local", "badge initial : aucun échange distant");
    assert.deepEqual(serverState.entries, {}, "compte vide à l'ouverture");

    /* Ordinateur : saisie puis « Enregistrer » — écriture locale immédiate et
       envoi distant immédiat (sans attendre les 5 s). L'échantillonnage
       rapide capte la chaîne complète des libellés du pied. */
    await page.fill('[data-workshop-field="textIt"]', "Anno sotto computer");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 5000 });
    const labelBeforeSave = await page.evaluate(() => window.__draftRemote.badge());
    await page.click("#workshopSaveDraftBtn");
    const samples = await page.evaluate(async () => {
      const seen = new Set();
      const status = document.getElementById("workshopSaveStatus");
      for (let index = 0; index < 70; index++) {
        seen.add(status.textContent);
        if (status.textContent === "Synchronisé entre appareils") break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      return [...seen];
    });
    assert.equal(labelBeforeSave, "Enregistré localement", "état local atteint avant l'envoi");
    assert.ok(samples.includes("Synchronisation en cours…"), `état « Synchronisation en cours… » observé (${samples.join(" / ")})`);
    assert.ok(samples.includes("Synchronisé entre appareils"), `état « Synchronisé entre appareils » observé (${samples.join(" / ")})`);

    const key = serverKey();
    assert.equal(Object.keys(serverState.entries).length, 1, "un seul brouillon distant pour la page");
    assert.equal(serverState.entries[key].version, 1, "première écriture distante = version 1");
    assert.equal(serverState.entries[key].ownerUid, "compte-remote-1", "propriétaire porté par le document distant");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Anno sotto computer", "contenu distant conforme");
    assert.equal(await page.evaluate(() => !!localStorage.getItem("familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1")), true, "copie locale conservée après confirmation distante");

    /* Délai ~5 s : une nouvelle frappe n'écrit pas à distance immédiatement. */
    await page.fill('[data-workshop-field="textIt"]', "Anno sotto computer, variante");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 5000 });
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => window.__draftRemote.badge()), "Enregistré localement", "avant les 5 s : local seulement");
    assert.equal(serverState.entries[key].version, 1, "aucune écriture à la frappe");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 9000 });
    assert.equal(serverState.entries[key].version, 2, "synchronisation automatique après ~5 s");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Anno sotto computer, variante", "dernier contenu distant");

    /* Second appareil (mobile) : contexte et localStorage isolés, distant seul. */
    const mobile = await createDevice();
    await openWorkshopOn(mobile);
    await mobile.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    assert.equal(await mobile.evaluate(() => window.__draftRemote.fieldValue()), "Anno sotto computer, variante", "brouillon distant chargé à l'ouverture sur le second appareil");
    assert.equal(await mobile.evaluate(() => !!localStorage.getItem("familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1")), true, "copie locale recréée sur le second appareil");

    /* Isolation des comptes : sur ce second appareil, un autre compte ne voit
       ni le brouillon distant d'autrui ni son contenu. */
    await exitWorkshop(mobile);
    await mobile.evaluate(() => { window.__draftRemoteUid = "compte-remote-autre"; window.__draftRemote.clearLocalDrafts(); });
    await openWorkshopOn(mobile);
    await mobile.waitForTimeout(1200);
    assert.equal(await mobile.evaluate(() => window.__draftRemote.badge()), "Brouillon local", "l'autre compte n'a aucun brouillon distant");
    assert.equal(Object.keys(serverState.entries).length, 1, "le brouillon du premier compte reste intact et isolé");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("brouillons synchronisés : conflits à choix explicite, hors ligne et récupération", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();

    /* Appareil 1 : première version publiée. */
    const page = await createDevice();
    await openWorkshopOn(page);
    await page.fill('[data-workshop-field="textIt"]', "Version ordinateur A");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 1, "version 1 publiée");

    /* Appareil 2 : version concurrente publiée (version 2). */
    const other = await createDevice({ uid: "compte-remote-1" });
    await openWorkshopOn(other);
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    await other.fill('[data-workshop-field="textIt"]', "Version mobile B");
    await other.click("#workshopSaveDraftBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 2, "appareil 2 publié en version 2");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Version mobile B", "contenu de l'appareil 2 en place");

    /* Conflit côté appareil 1 : la base obsolète n'écrase rien, les deux
       versions sont présentées, choix explicite exigé. */
    await page.fill('[data-workshop-field="textIt"]', "Version ordinateur A modifiée");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Conflit à résoudre", undefined, { timeout: 5000 });
    assert.equal(await page.locator("#transcriptionDraftConflictDialog").isVisible(), true, "dialogue de conflit ouvert");
    assert.equal(await page.locator("#workshopConflictBtn").isVisible(), true, "bouton « Résoudre » visible en pied");
    const localText = await page.locator("#transcriptionDraftConflictLocalText").inputValue();
    const remoteText = await page.locator("#transcriptionDraftConflictRemoteText").inputValue();
    assert.ok(localText.includes("Version ordinateur A modifiée"), "version locale présentée");
    assert.ok(remoteText.includes("Version mobile B"), "version distante présentée");
    assert.equal(serverState.entries[key].version, 2, "aucune écriture pendant le conflit");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Version mobile B", "contenu distant intact pendant le conflit");

    /* Choix : conserver la version distante — appliquée telle quelle. */
    await page.click("#transcriptionDraftConflictKeepRemoteBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__draftRemote.fieldValue()), "Version mobile B", "version distante appliquée localement");
    assert.equal(serverState.entries[key].version, 2, "adoption sans écriture inutile");
    assert.equal(await page.locator("#transcriptionDraftConflictDialog").isVisible(), false, "dialogue fermé après choix");

    /* Second conflit avec l'autre appareil, choix : conserver la version locale. */
    await other.fill('[data-workshop-field="textIt"]', "Version mobile B, seconde main");
    await other.click("#workshopSaveDraftBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 3, "appareil 2 passé en version 3");
    await page.fill('[data-workshop-field="textIt"]', "Version ordinateur A, choix local");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Conflit à résoudre", undefined, { timeout: 5000 });
    await page.click("#transcriptionDraftConflictKeepLocalBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 4, "choix local publié en version 4 (incrémentation)");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Version ordinateur A, choix local", "contenu local conservé sur le compte");

    /* Hors ligne : local préservé, échec annoncé, aucune donnée perdue. */
    serverState.offline = true;
    await page.fill('[data-workshop-field="textIt"]', "Texte saisi hors ligne");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisation impossible", undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__draftRemote.fieldValue()), "Texte saisi hors ligne", "contenu en mémoire intact");
    assert.equal(await page.evaluate(() => !!localStorage.getItem("familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1")), true, "copie locale conservée malgré l'échec distant");
    assert.equal(serverState.entries[key].version, 4, "le distant n'a pas bougé pendant l'échec");
    const failureToast = await page.evaluate(() => [...document.querySelectorAll(".toast")].some(toast => toast.textContent.includes("La synchronisation entre appareils a échoué")));
    assert.equal(failureToast, true, "notification claire d'échec de synchronisation");

    /* Reconnexion : récupération automatique, aucun conflit fabriqué. */
    serverState.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    assert.equal(serverState.entries[key].version, 5, "après reconnexion : écriture différée puis publiée");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Texte saisi hors ligne", "contenu hors ligne récupéré");

    await other.close();
    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("scénario 1-2 : suppression distante explicite, jamais de réapparition silencieuse", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();
    const localKey = "familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1";

    /* Appareil A publie la version 1 ; appareil B la restaure (local + base). */
    const page = await createDevice();
    await openWorkshopOn(page);
    await page.fill('[data-workshop-field="textIt"]', "Version publiée sur ordinateur");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 1, "version 1 publiée");

    const other = await createDevice();
    await openWorkshopOn(other);
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    assert.equal(await other.evaluate(k => !!localStorage.getItem(k), localKey), true, "second appareil : copie locale créée");

    /* Scénario 1 : suppression sur A (« Annuler les modifications » du menu,
       confirmation native auto-acceptée par le harnais) → purge distante
       différée (~5 s) uniquement sur version de référence connue. */
    await page.evaluate(() => document.getElementById("workshopResetBtn").click());
    await waitForRemote("purge distante après annulation sur A", () => Object.keys(serverState.entries).length === 0);
    assert.equal(await other.evaluate(k => !!localStorage.getItem(k), localKey), true, "la suppression sur A ne touche PAS la copie locale de B");

    /* Scénario 2 (écriture) : B, qui conserve l'ancienne version, modifie —
       aucune republication silencieuse, conflit explicite à la place. */
    await other.fill('[data-workshop-field="textIt"]', "Version modifiée après suppression");
    await other.click("#workshopSaveDraftBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Conflit à résoudre", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key], undefined, "aucune republication silencieuse du brouillon supprimé");
    assert.equal(await other.evaluate(k => localStorage.getItem(k).includes("Version modifiée après suppression"), localKey), true, "version locale intacte pendant le conflit (récupérable)");
    assert.equal(await other.locator("#transcriptionDraftConflictDialog").isVisible(), true, "dialogue de conflit ouvert");
    assert.equal(await other.locator("#transcriptionDraftConflictRemoteText").inputValue(), "(aucun brouillon distant)", "côté distant présenté comme vide");
    assert.equal(await other.locator("#transcriptionDraftConflictLocalText").inputValue().then(value => value.includes("Version modifiée après suppression")), true, "côté local présenté");

    /* Choix explicite : conserver la version distante (= accepter la
       suppression) → la copie locale est retirée sur décision, pas en silence. */
    await other.click("#transcriptionDraftConflictKeepRemoteBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Brouillon local", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key], undefined, "acceptation de la suppression : distant toujours vide");
    assert.equal(await other.evaluate(k => localStorage.getItem(k), localKey), null, "copie locale retirée sur choix explicite");

    /* Republication seulement explicite : une nouvelle saisie crée à nouveau. */
    await other.fill('[data-workshop-field="textIt"]', "Après choix explicite");
    await other.click("#workshopSaveDraftBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 1, "re-création v1 après décision explicite");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Après choix explicite", "contenu volontairement republié");

    /* Scénario 2 (ouverture) : la suppression a lieu ailleurs pendant que B
       est fermé → détection à l'ouverture, aucune poussée, choix explicite. */
    delete serverState.entries[key];
    await exitWorkshop(other);
    await openWorkshopOn(other);
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Conflit à résoudre", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key], undefined, "à l'ouverture : aucune republication automatique");
    assert.equal(await other.locator("#transcriptionDraftConflictDialog").isVisible(), true, "conflit de suppression présenté à l'ouverture");
    await other.click("#transcriptionDraftConflictKeepLocalBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 1, "« Conserver la version de cet appareil » : republication v1 assumée");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Après choix explicite", "contenu local republié tel quel");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("scénario 4 : retour en ligne après modification distante = conflit, jamais d'écrasement", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();
    const localKey = "familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1";

    const page = await createDevice();
    await openWorkshopOn(page);
    await page.fill('[data-workshop-field="textIt"]', "Version ordinateur A");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });

    /* Pendant l'absence de A, un autre appareil publie la version 2. */
    const other = await createDevice();
    await openWorkshopOn(other);
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    await other.fill('[data-workshop-field="textIt"]', "Version mobile B");
    await other.click("#workshopSaveDraftBtn");
    await other.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 2, "distant porté à la version 2");

    /* A modifie hors ligne : local conservé, aucun écriture, échec annoncé. */
    serverState.offline = true;
    await page.fill('[data-workshop-field="textIt"]', "Texte hors ligne");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisation impossible", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 2, "hors ligne : le distant modifié n'est pas touché");
    assert.equal(await page.evaluate(k => localStorage.getItem(k).includes("Texte hors ligne"), localKey), true, "version locale enregistrée localement");

    /* Retour en ligne : la référence obsolète ne donne aucun écrasement —
       conflit explicite, les deux contenus sont conservés. */
    serverState.offline = false;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Conflit à résoudre", undefined, { timeout: 8000 });
    assert.equal(serverState.entries[key].version, 2, "retour en ligne : distant inchangé, aucune écriture silencieuse");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Version mobile B", "contenu de l'autre appareil intact");
    assert.equal(await page.locator("#transcriptionDraftConflictDialog").isVisible(), true, "dialogue de conflit au retour en ligne");
    assert.equal(await page.locator("#transcriptionDraftConflictLocalText").inputValue().then(value => value.includes("Texte hors ligne")), true, "côté local : le texte hors ligne");
    assert.equal(await page.locator("#transcriptionDraftConflictRemoteText").inputValue().then(value => value.includes("Version mobile B")), true, "côté distant : la version de l'autre appareil");

    await page.click("#transcriptionDraftConflictKeepLocalBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 3, "choix local : publication en version 3 (incrémentation)");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Texte hors ligne", "contenu hors ligne publié sur décision");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("scénario 5 : changement de compte pendant une écriture en attente = envoi abandonné", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();
    const localKey = "familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1";

    const page = await createDevice(); // uid « compte-remote-1 »
    await openWorkshopOn(page);
    await page.fill('[data-workshop-field="textIt"]', "Contenu du premier compte");
    /* Autosauvegarde locale confirmée : le minuteur d'envoi (~5 s) est armé,
       aucun envoi immédiat. */
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 5000 });
    assert.deepEqual(serverState.entries, {}, "aucun envoi avant le délai");

    /* Changement de compte avant le déclenchement : l'envoi du compte
       précédent doit être abandonné — ni écriture, ni statut distant. */
    await page.evaluate(() => { window.__draftRemoteUid = "compte-remote-2"; });
    await page.waitForTimeout(6500);
    assert.deepEqual(serverState.entries, {}, "aucun envoi du compte précédent sous le compte suivant");
    assert.equal(await page.evaluate(() => window.__draftRemote.badge()), "Enregistré localement", "statut local seul : aucun « Synchronisé entre appareils »");
    assert.equal(await page.evaluate(k => localStorage.getItem(k).includes("Contenu du premier compte"), localKey), true, "copie locale du premier compte intacte");

    /* Retour au compte original : publication sous le BON compte (local
       préservé, isolation de l'envoi démontrée). */
    await page.evaluate(() => { window.__draftRemoteUid = "compte-remote-1"; });
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].version, 1, "publié au retour du compte original");
    assert.equal(serverState.entries[key].ownerUid, "compte-remote-1", "propriétaire = compte d'origine");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Contenu du premier compte", "contenu du premier compte, jamais réorienté");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("isolation locale : deux comptes sur le même navigateur, brouillon non synchronisé et retour du compte", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();
    const localA = "familyTreeTranscriptionDraft:compte-remote-1|doc-remote|page-remote-1";
    const localB = "familyTreeTranscriptionDraft:compte-remote-2|doc-remote|page-remote-1";

    /* Compte 1 : brouillon local enregistré mais NON synchronisé (hors ligne). */
    const page = await createDevice({ uid: "compte-remote-1" });
    await openWorkshopOn(page);
    serverState.offline = true;
    await page.fill('[data-workshop-field="textIt"]', "Brouillon du premier compte");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Enregistré localement", undefined, { timeout: 5000 });
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisation impossible", undefined, { timeout: 5000 });
    assert.deepEqual(serverState.entries, {}, "hors ligne : rien publié");
    assert.equal(await page.evaluate(k => localStorage.getItem(k).includes("Brouillon du premier compte"), localA), true, "copie locale du compte 1 enregistrée");
    serverState.offline = false;

    /* Changement de compte : le compte 2 ne lit ni n'écrit l'espace du 1. */
    await exitWorkshop(page);
    await page.evaluate(() => { window.__draftRemoteUid = "compte-remote-2"; });
    await openWorkshopOn(page);
    await page.waitForTimeout(1000);
    assert.equal(await page.evaluate(() => window.__draftRemote.badge()), "Brouillon local", "compte 2 : aucun brouillon restauré");
    assert.notEqual(await page.evaluate(() => window.__draftRemote.fieldValue()), "Brouillon du premier compte", "compte 2 : jamais le texte du compte 1");
    assert.equal(await page.evaluate(k => !!localStorage.getItem(k), localA), true, "brouillon du compte 1 intact");
    assert.equal(await page.evaluate(k => !!localStorage.getItem(k), localB), false, "aucun espace ouvert pour le compte 2");

    /* Sauvegarde du compte 2 : espace propre, aucune écrasement du compte 1. */
    await page.fill('[data-workshop-field="textIt"]', "Brouillon du second compte");
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(await page.evaluate(k => localStorage.getItem(k).includes("Brouillon du second compte"), localB), true, "copie locale du compte 2 dans SON espace");
    assert.equal(await page.evaluate(k => localStorage.getItem(k).includes("Brouillon du premier compte"), localA), true, "écriture du compte 2 sans écrasement du compte 1");
    assert.equal(Object.keys(serverState.entries).length, 1, "un seul distant publié (celui du compte 2)");
    const publishedBySecond = Object.keys(serverState.entries)[0];
    assert.ok(publishedBySecond.includes("|compte-remote-2|"), "distant publié dans l'espace du compte 2");
    assert.equal(serverState.entries[publishedBySecond].ownerUid, "compte-remote-2", "distant publié sous le compte 2");

    /* Retour du compte 1 (reconnexion) : reprise de SON brouillon, puis
       migration vers son propre espace distant — jamais sous un autre compte. */
    await exitWorkshop(page);
    await page.evaluate(() => { window.__draftRemoteUid = "compte-remote-1"; });
    await openWorkshopOn(page);
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__draftRemote.fieldValue()), "Brouillon du premier compte", "brouillon du compte 1 restauré à son retour");
    const serverKeys = Object.keys(serverState.entries);
    assert.equal(serverKeys.length, 2, "les deux comptes ont leur propre distant");
    assert.ok(serverKeys.some(entry => entry.includes("|compte-remote-1|")), "distant du compte 1 présent");
    assert.ok(serverKeys.some(entry => entry.includes("|compte-remote-2|")), "distant du compte 2 présent");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt, "Brouillon du premier compte", "contenu du compte 1 publié sous le compte 1");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("reprise d'un ancien brouillon sans UID : explicite, non destructive, jamais synchronisée en l'état", { timeout: 120000 }, async t => {
  const harness = await openRemoteHarness(t);
  if (!harness) return;
  const { browser, server, serverState, contexts, pageErrors, createDevice } = harness;
  try {
    const key = serverKey();
    const page = await createDevice(); // uid « compte-remote-1 »
    await page.evaluate(() => window.__draftRemote.seedLegacyDraft());
    const legacy = await page.evaluate(() => window.__draftRemote.legacyKey());
    const owned = await page.evaluate(() => window.__draftRemote.ownedKeyOf("compte-remote-1"));
    const legacyIntact = () => page.evaluate(k => (localStorage.getItem(k) || "").includes("Anno del testamento ereditato"), legacy);

    /* Ouverture : aucune attribution automatique — offre explicite. */
    await openWorkshopOn(page);
    await page.waitForFunction(() => document.getElementById("transcriptionDraftRecoveryDialog").open, undefined, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__draftRemote.fieldValue()), "Anno millenovecento", "non restauré avant le choix (jamais automatique)");
    assert.deepEqual(serverState.entries, {}, "aucune synchronisation du brouillon hérité");
    assert.equal(await legacyIntact(), true, "hérité intact à l'ouverture");
    assert.equal(await page.locator("#transcriptionDraftRecoveryText").inputValue().then(value => value.includes("Anno del testamento ereditato")), true, "aperçu du contenu proposé");

    /* « Le laisser tel quel » : rien n'est écrit, rien n'est supprimé, pas de relance. */
    await page.click("#transcriptionDraftRecoveryLeaveBtn");
    await page.waitForFunction(() => !document.getElementById("transcriptionDraftRecoveryDialog").open);
    assert.equal(await page.evaluate(() => window.__draftRemote.badge()), "Brouillon local", "aucun brouillon activé");
    assert.equal(await legacyIntact(), true, "hérité intact après le refus");
    assert.deepEqual(serverState.entries, {}, "toujours aucune synchronisation");
    await exitWorkshop(page);
    await openWorkshopOn(page);
    await page.waitForTimeout(1200);
    assert.equal(await page.evaluate(() => document.getElementById("transcriptionDraftRecoveryDialog").open), false, "choix marqué : l'offre n'est pas relancée");
    assert.equal(await legacyIntact(), true, "hérité intact après réouverture");

    /* Reprise explicite (nouvelle offre : marqueur réinitialisé) : le contenu
       est rattaché au compte, la copie héritée reste sur l'appareil. */
    await exitWorkshop(page);
    await page.evaluate(() => window.__draftRemote.seedLegacyDraft());
    await openWorkshopOn(page);
    await page.waitForFunction(() => document.getElementById("transcriptionDraftRecoveryDialog").open, undefined, { timeout: 10000 });
    await page.click("#transcriptionDraftRecoveryClaimBtn");
    await page.waitForFunction(() => !document.getElementById("transcriptionDraftRecoveryDialog").open);
    assert.equal(await page.evaluate(() => window.__draftRemote.fieldValue().includes("Anno del testamento ereditato") || window.__draftRemote.fieldValue().includes("Anno del testamento")), true, "contenu hérité restauré dans l'atelier");
    assert.equal(await page.evaluate(k => (localStorage.getItem(k) || "").includes("Anno del testamento ereditato"), owned), true, "copie rattachée à l'espace du compte");
    assert.equal(await legacyIntact(), true, "reprise non destructive : hérité conservé");

    /* Reconnexion à la synchronisation : le contenu repris part sous LE compte. */
    await page.click("#workshopSaveDraftBtn");
    await page.waitForFunction(() => document.getElementById("workshopSaveStatus").textContent === "Synchronisé entre appareils", undefined, { timeout: 5000 });
    assert.equal(serverState.entries[key].ownerUid, "compte-remote-1", "repris publié sous le compte qui a repris");
    assert.equal(serverState.entries[key].snapshot.passages[0].textIt.includes("testamento ereditato"), true, "contenu repris publié tel quel");
    assert.equal(await legacyIntact(), true, "hérité toujours intact après synchronisation");

    assertNoWorkshopPageErrors(pageErrors);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
