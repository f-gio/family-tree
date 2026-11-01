import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

/* Validation officielle, historique et repli du volet Document (incrément 2).
   Chromium uniquement : les écritures officielles réelles sont couvertes par
   l'émulateur (tests/firestore-emulator.mjs) ; ici, l'interface, les états du
   badge, le dialogue de confirmation, l'historique consultable et le repli
   desktop sont vérifiés sur le parcours réel — le réseau distant étant bloqué
   par le harnais, le cas « échec réseau conserve le brouillon » est testé tel quel. */

const SVG = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="200"><rect width="800" height="200" fill="#b8c9be"/></svg>');

const HOOKS = `
window.__inc2 = {
  passagesFixture() {
    return [
      { id: "p-1", order: 0, textIt: "Anno millenovecento", translationFr: "L’année mille neuf cent", separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 1", translationState: "current" },
      { id: "p-2", order: 1, textIt: "indici di Orino", translationFr: null, separatorAfter: "", unreadable: false, hypotheses: [], anchor: null, lineLabel: "l. 2", translationState: "not-started" }
    ];
  },
  show() { $("authScreen").hidden = true; $("topbar").hidden = false; setView("directory"); },
  seed() {
    const documentItem = {
      id: "doc-repro", title: "Registre Transactions Immobilières",
      type: "Registre", date: "1891-05-12",
      fileName: "registre.jpg", mimeType: "image/jpeg",
      fileData: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGcP//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEQAD8kf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIDAT8kf//Z",
      personIds: [],
      pages: [{ id: "page-repro-1", label: "Folio 1", photographs: [{ id: "photo-repro-1", preview: { dataUrl: "${SVG}" } }], passages: window.__inc2.passagesFixture() }]
    };
    documents = [documentItem];
    people = [];
    loadedPeople = loadedDocuments = true;
    genealogyRecords = { sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [], genealogyProofs: [], genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [], genealogyProposals: [], genealogyEvents: [], genealogyNotifications: [] };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Administratrice Atelier" };
    adminUsersCache = [{ id: "admin-seed", displayName: "Administratrice Seed", status: "approved", role: "admin" }];
    renderGenealogyWorkspace();
  },
  /* Version officielle existante : même contenu que la page (badge « Validée »). */
  seedOfficial() {
    const passages = window.__inc2.passagesFixture();
    const content = {
      documentId: "doc-repro",
      pageId: "page-repro-1",
      passages,
      transcriptionIt: "Anno millenovecento\\nindici di Orino",
      translationFr: "L’année mille neuf cent",
      changeKind: "initial",
      justification: "Validation de la transcription",
      authorUid: "admin-seed",
      previousRevisionId: null
    };
    genealogyRecords.transcriptionHeads = [{
      id: "tx-seed-head", data: content, version: 1, revisionId: "tx-seed-rev1",
      createdAt: new Date("2026-10-20T10:00:00Z"), createdBy: "admin-seed",
      updatedAt: new Date("2026-10-20T10:00:00Z"), updatedBy: "admin-seed", eventId: "tx-seed-ev1"
    }];
    genealogyRecords.transcriptionRevisions = [{
      id: "tx-seed-rev1", objectId: "tx-seed-head", authorUid: "admin-seed",
      createdAt: new Date("2026-10-20T10:00:00Z"), previousRevisionId: null,
      data: content, eventId: "tx-seed-ev1"
    }];
  },
  openDoc() { setView("directory"); openStoredDocument(documents[0], "directory"); },
  transcribe() { const button = document.querySelector("#viewerDocumentDetails [data-transcribe-document]"); if (button) button.click(); },
  badge() { return $("workshopSaveStatus").textContent; },
  officialBadge() { const el = $("workshopOfficialBadge"); return { hidden: el.hidden, text: el.textContent }; },
  fieldValue() { return document.querySelector('[data-workshop-field="textIt"]')?.value || ""; }
};
`;

const AUTH_PATCH = `
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

async function openInc2Harness(t) {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const server = await startStaticServer(ROOT);
  const hooks = `${HOOKS}\n${AUTH_PATCH}`;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
    }
    return url.startsWith(server.baseURL) || url.includes("gstatic.com") ? route.continue() : route.abort("blockedbyclient");
  });
  const pageErrors = [];
  const page = await context.newPage();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", async dialog => { await dialog.accept(); });
  await page.goto(server.baseURL, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__inc2 === "object");
  return { browser, server, context, page, pageErrors };
}

async function bootInc2(page) {
  await page.evaluate(() => { window.__inc2.show(); window.__inc2.seed(); });
}

async function openInc2Workshop(page) {
  await page.evaluate(() => { window.__inc2.openDoc(); window.__inc2.transcribe(); });
  await page.waitForFunction(() => !document.getElementById("transcriptionWorkshopView").hidden);
}

function assertNoInc2PageErrors(pageErrors) {
  const relevant = pageErrors.filter(message => /workshop|transcription|validation|genealogyStore/i.test(message));
  assert.deepEqual(relevant, [], `aucune erreur applicative (${relevant.join(" | ")})`);
}

test("badges et états : Brouillon, Validée · vN, Révision en cours · vN — Enregistrer armé/désarmé", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    /* Sans version officielle : badge « Brouillon », validation primaire
       proposée pour le premier enregistrement, Enregistrer inactif au repos. */
    await bootInc2(page);
    await openInc2Workshop(page);
    await page.waitForFunction(() => window.__inc2.officialBadge().text !== "", undefined, { timeout: 5000 });
    const initial = await page.evaluate(() => ({
      badge: window.__inc2.officialBadge(),
      validateHidden: document.getElementById("workshopValidateBtn").hidden,
      validateLabel: document.getElementById("workshopValidateLabel").textContent,
      validateDisabled: document.getElementById("workshopValidateBtn").disabled,
      saveDisabled: document.getElementById("workshopSaveDraftBtn").disabled,
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed")
    }));
    assert.equal(initial.badge.hidden, false, "badge d'état visible");
    assert.equal(initial.badge.text, "Brouillon", "sans version officielle : « Brouillon »");
    assert.equal(initial.validateHidden, false, "validation visible pour l'administrateur");
    assert.equal(initial.validateLabel, "Valider la transcription", "libellé du premier enregistrement");
    assert.equal(initial.validateDisabled, false, "validation active (texte italien non vide)");
    assert.equal(initial.saveDisabled, true, "Enregistrer inactif sans modification non sauvegardée");
    assert.equal(initial.collapsed, false, "vue partagée par défaut");

    /* Modification locale : Enregistrer réarmé immédiatement. */
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecento modificato");
    assert.equal(await page.locator("#workshopSaveDraftBtn").isDisabled(), false, "Enregistrer réarmé dès la saisie");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Brouillon",
      "sans officiel, la modification reste un simple brouillon");

    /* Aucune écriture distante ni officielle n'est tentée : le badge et le
       dialogue restent cohérents même hors connexion. */
    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("validation : confirmation précise, échec réseau sans perte du brouillon, boutons distincts", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await openInc2Workshop(page);
    await page.fill('[data-workshop-field="textIt"]', "Anno della conferma");

    /* Dialogue : version, historique et distinction avec Enregistrer/Comparer. */
    await page.click("#workshopValidateBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionValidationDialog").open, undefined, { timeout: 5000 });
    const message = await page.locator("#transcriptionValidationMessage").textContent();
    assert.match(message, /version v1/, "numéro de version annoncé");
    assert.match(message, /historique/i, "conservation de l'historique annoncée");
    assert.match(message, /traduction française reste facultative/i, "traduction française explicitement facultative");
    assert.match(await page.locator("#transcriptionValidationDialog .hint").textContent(), /Enregistrer.*Comparer.*Valider|« Enregistrer »/, "distinction Enregistrer / Comparer / Valider rappelée");

    /* En ligne=false ignoré (toujours true sous Playwright) : le réseau réellement
       bloqué fait échouer la validation — le brouillon est intégralement conservé. */
    await page.click("#transcriptionValidationConfirmBtn");
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationError").hidden, undefined, { timeout: 10000 });
    const failure = await page.locator("#transcriptionValidationError").textContent();
    assert.ok(failure.trim().length > 0, "erreur d'affichée en clair");
    assert.equal(await page.evaluate(() => window.__inc2.fieldValue()), "Anno della conferma", "brouillon intact après l'échec");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Brouillon", "aucune version officielle créée");
    assert.equal(await page.evaluate(() => document.getElementById("transcriptionValidationDialog").open), true, "dialogue conservé pour réessayer");

    /* Fermeture sans validation : rien n'a changé. */
    await page.locator('[data-close="transcriptionValidationDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionValidationDialog").open);
    assert.equal(await page.evaluate(() => window.__inc2.fieldValue()), "Anno della conferma", "brouillon intact après fermeture");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("historique : versions listées avec auteur et date, consultation en lecture seule depuis l'atelier", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await page.evaluate(() => window.__inc2.seedOfficial());
    await openInc2Workshop(page);

    /* Badge et libellé reflètent la version officielle ; la modification crée
       un brouillon de révision SANS nouvelle version, le retour au texte
       officiel rétablit « Validée » sans écriture. */
    await page.waitForFunction(() => window.__inc2.officialBadge().text !== "", undefined, { timeout: 8000 });
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v1", "contenu officiel : Validée · v1");
    assert.equal(await page.locator("#workshopValidateLabel").textContent(), "Valider la révision", "action suivante : validation de révision");
    await page.fill('[data-workshop-field="textIt"]', "Anno con modifica");
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Révision en cours · v1", "modification : Révision en cours · v1");
    await page.fill('[data-workshop-field="textIt"]', "Anno millenovecento");
    await page.waitForFunction(() => window.__inc2.officialBadge().text === "Validée · v1", undefined, { timeout: 3000 });
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v1", "retour au texte officiel : Validée rétablie sans nouvelle version");

    /* Historique consultable sans quitter l'atelier. */
    await page.click("#workshopHistoryBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionHistoryDialog").open, undefined, { timeout: 5000 });
    const rows = await page.locator("[data-history-revision]").count();
    assert.equal(rows, 1, "une version listée");
    assert.match(await page.locator("[data-history-revision]").textContent(), /v1 · version actuelle/, "version actuelle repérée");
    assert.match(await page.locator("[data-history-revision]").textContent(), /Administratrice Seed/, "auteur de la version affiché");
    assert.match(await page.locator("[data-history-revision]").textContent(), /\d/, "date affichée");
    assert.equal(await page.evaluate(() => !document.getElementById("transcriptionWorkshopView").hidden), true, "atelier non quitté");

    /* Consultation détaillée : texte officiel en lecture seule + comparaisons. */
    await page.click('[data-history-revision="tx-seed-rev1"]');
    await page.waitForFunction(() => !document.getElementById("transcriptionHistoryDetail").hidden, undefined, { timeout: 5000 });
    const detail = await page.locator("#transcriptionHistoryDetail").textContent();
    assert.match(detail, /Anno millenovecento/, "texte de la version affiché");
    assert.match(detail, /Version initiale officielle/, "comparaison avec la version précédente (initial)");
    assert.match(detail, /Brouillon courant/, "comparaison avec le brouillon courant");
    assert.match(detail, /Traduction française/, "état de la traduction française suivi séparément");
    assert.ok(await page.locator("#transcriptionHistoryBackBtn").isVisible(), "retour à la liste");
    await page.click("#transcriptionHistoryBackBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionHistoryDetail").hidden && !document.getElementById("transcriptionHistoryList").hidden, undefined, { timeout: 5000 });
    await page.locator('[data-close="transcriptionHistoryDialog"]').first().click();
    await page.waitForFunction(() => !document.getElementById("transcriptionHistoryDialog").open);

    /* L'atelier est intact après consultation. */
    assert.equal(await page.evaluate(() => window.__inc2.officialBadge().text), "Validée · v1", "badge intact après l'historique");
    assert.equal(await page.evaluate(() => !document.getElementById("transcriptionWorkshopView").hidden), true, "toujours dans l'atelier");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});

test("repli du volet Document : vue étendue, contenu et défilement conservés, réouverture complète", { timeout: 120000 }, async t => {
  const harness = await openInc2Harness(t);
  if (!harness) return;
  const { browser, server, context, page, pageErrors } = harness;
  try {
    await bootInc2(page);
    await openInc2Workshop(page);

    /* Défilement initial non nul pour vérifier la conservation. */
    await page.evaluate(() => {
      const list = document.getElementById("workshopPassageList");
      list.scrollTop = 0;
      list.dispatchEvent(new Event("scroll"));
    });
    const before = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || "",
      status: document.getElementById("workshopSaveStatus").textContent,
      selected: document.querySelector(".transcription-workshop-passage.is-selected")?.id || "",
      stored: (function () { let n = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("familyTreeTranscriptionDraft:")) n++; return n; })()
    }));
    assert.equal(before.collapsed, false, "vue partagée à l'ouverture");

    /* Repli : desktop uniquement, volet gauche masqué, transcription étendue. */
    await page.click("#workshopPanelCollapseBtn");
    const collapsed = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      originalDisplay: getComputedStyle(document.getElementById("workshopPanelOriginal")).display,
      dividerDisplay: getComputedStyle(document.getElementById("workshopDivider")).display,
      restoreVisible: getComputedStyle(document.querySelector(".transcription-workshop-restore-row")).display !== "none",
      rightWidth: Math.round(document.getElementById("workshopPanelRight").getBoundingClientRect().width),
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || "",
      status: document.getElementById("workshopSaveStatus").textContent,
      selected: document.querySelector(".transcription-workshop-passage.is-selected")?.id || "",
      expandFocused: document.activeElement?.id === "workshopPanelExpandBtn",
      stored: (function () { let n = 0; for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("familyTreeTranscriptionDraft:")) n++; return n; })()
    }));
    assert.equal(collapsed.collapsed, true, "état de repli appliqué");
    assert.equal(collapsed.originalDisplay, "none", "volet document masqué");
    assert.equal(collapsed.dividerDisplay, "none", "séparateur masqué");
    assert.equal(collapsed.restoreVisible, true, "commande « Afficher le document » visible en haut à gauche");
    assert.equal(collapsed.expandFocused, true, "focus déplacé sur la commande (clavier)");
    assert.equal(collapsed.field, before.field, "texte conservé");
    assert.equal(collapsed.status, before.status, "aucune sauvegarde ni changement d'état déclenché par le repli");
    assert.equal(collapsed.selected, before.selected, "passage actif conservé");
    assert.equal(collapsed.stored, before.stored, "aucune écriture locale déclenchée par le repli");

    /* Réouverture : proportions initiales restaurées. */
    await page.click("#workshopPanelExpandBtn");
    const expanded = await page.evaluate(() => ({
      collapsed: document.getElementById("workshopLayout").classList.contains("is-document-collapsed"),
      originalDisplay: getComputedStyle(document.getElementById("workshopPanelOriginal")).display,
      collapseFocused: document.activeElement?.id === "workshopPanelCollapseBtn",
      field: document.querySelector('[data-workshop-field="textIt"]')?.value || ""
    }));
    assert.equal(expanded.collapsed, false, "vue partagée restaurée");
    assert.notEqual(expanded.originalDisplay, "none", "volet document visible à nouveau");
    assert.equal(expanded.collapseFocused, true, "focus rendu à la commande de repli");
    assert.equal(expanded.field, before.field, "texte toujours conservé");

    /* Une nouvelle session d'atelier repart en vue partagée. */
    await page.click("#workshopBackBtn");
    await page.waitForFunction(() => document.getElementById("transcriptionWorkshopView").hidden);
    await openInc2Workshop(page);
    const reopened = await page.evaluate(() => document.getElementById("workshopLayout").classList.contains("is-document-collapsed"));
    assert.equal(reopened, false, "vue partagée par défaut à la réouverture (session nouvelle)");

    assertNoInc2PageErrors(pageErrors);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
