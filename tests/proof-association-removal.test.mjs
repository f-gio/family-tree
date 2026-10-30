import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";
import { ROOT, startStaticServer } from "./helpers.mjs";

/* Régression §4 : retirer des personnes (et le document) d'une Preuve pendant
   une révision doit produire un payload de révision réellement vidé — la
   preuve peut exister sans personne ni document associés. Le contrat testé est
   exactement ce qui part vers Firestore (proofGuidedPayload + composition de
   saveGenealogyContribution). */

const source = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

const hooks = `
window.__proofAssocTest = {
  seed() {
    currentUserProfile = { role: "admin" };
    primaryAdminUid = "admin-test";
    people = [
      { id: "person-a", firstName: "Ada", middleName: "", lastName: "Alpha", birthDate: "", deathDate: "", place: "", partnerIds: [], childIds: [] },
      { id: "person-b", firstName: "Grace", middleName: "", lastName: "Beta", birthDate: "", deathDate: "", place: "", partnerIds: [], childIds: [] }
    ];
    loadedPeople = true;
    documents = [{ id: "doc-1", title: "Registre 1901", type: "Registre", date: "1901", place: "", personIds: ["person-a", "person-b"], notes: "", fileName: "registre.html", mimeType: "text/html", chunkCount: 0, pages: [{ id: "page-1", label: "Folio 1" }] }];
    loadedDocuments = true;
    genealogyRecords.genealogyProofs = [{
      id: "proof-fixture",
      version: 1,
      revisionId: "rev-1",
      data: {
        id: "proof-fixture",
        factId: "fact-birth-ada",
        factType: "birth",
        personIds: ["person-a", "person-b"],
        relationshipId: null,
        familyId: null,
        documentId: "doc-1",
        pageId: null,
        passageId: null,
        transcriptionRevisionId: null,
        photographId: null,
        zone: null,
        citation: { textIt: null, translationFr: null },
        sourceValue: "12 mars 1890",
        relation: "supports",
        interpretation: "",
        authorUid: "admin-test",
        createdAt: "2026-01-01T00:00:00.000Z",
        technicalStatus: "active",
        suspension: null,
        statusHistory: []
      }
    }];
  },
  openRevision() {
    const dialog = $("genealogyContributionDialog");
    if (dialog.open) dialog.close();
    const item = genealogyWorkspaceItems().find(value => value.kind === "proof" && value.record.id === "proof-fixture");
    if (!item) throw new Error("proof-fixture introuvable dans genealogyWorkspaceItems");
    openGenealogyContribution({ official: true, reviseItem: item });
  },
  formState() {
    return {
      open: $("genealogyContributionDialog").open,
      type: $("genealogyContributionType").value,
      personChips: [...$("genealogySourcePersonSelection").querySelectorAll(".person-multiselect-chip-label")].map(node => node.textContent),
      documentChips: [...$("genealogySourceDocumentSelection").querySelectorAll(".source-document-selection-item > span")].map(node => node.textContent)
    };
  },
  removePerson(id) {
    const button = document.querySelector('[data-remove-genealogy-source-person="' + id + '"]');
    if (button) button.click();
  },
  removeDocument(id) {
    const button = document.querySelector('[data-remove-genealogy-source-document="' + id + '"]');
    if (button) button.click();
  },
  savePayload() {
    const payload = proofGuidedPayload("proof-fixture");
    const proofInput = { ...(payload.data || payload) };
    if (!proofInput.factId) proofInput.factId = "proof-fixture";
    const proof = { ...createGenealogyProof({ ...proofInput, id: "proof-fixture", authorUid: "admin-test", createdAt: new Date().toISOString() }), ...proofInput, id: "proof-fixture" };
    const validation = validateGenealogyProof(proof);
    return { personIds: proof.personIds, documentId: proof.documentId, pageId: proof.pageId, valid: validation.valid, errors: validation.errors };
  },
  emptyProofAndReopen() {
    this.removePerson("person-b");
    this.removePerson("person-a");
    this.removeDocument("doc-1");
    const payload = proofGuidedPayload("proof-fixture");
    const proofInput = { ...(payload.data || payload) };
    if (!proofInput.factId) proofInput.factId = "proof-fixture";
    const proof = { ...createGenealogyProof({ ...proofInput, id: "proof-fixture", authorUid: "admin-test", createdAt: new Date().toISOString() }), ...proofInput, id: "proof-fixture" };
    const head = genealogyRecords.genealogyProofs.find(item => item.id === "proof-fixture");
    head.data = { ...head.data, ...proof };
    this.openRevision();
  }
};
`;

test("Retrait des associations d'une Preuve en révision persiste réellement (§4)", { timeout: 90000 }, async t => {
  const server = await startStaticServer(ROOT);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "fr-FR" });
    await context.route("**/*", async route => {
      const url = route.request().url();
      if (url.includes("/js/app.js")) {
        const response = await route.fetch();
        return route.fulfill({ response, body: `${await response.text()}\n${hooks}` });
      }
      return route.continue();
    });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    try {
      await page.goto(server.baseURL, { waitUntil: "load" });
      await page.waitForFunction(() => typeof window.__proofAssocTest === "object");
      await page.evaluate(() => {
        document.getElementById("authScreen").hidden = true;
        document.getElementById("topbar").hidden = false;
        document.getElementById("appMain").hidden = false;
        window.__proofAssocTest.seed();
      });

      /* 1. Ouverture de la révision : les deux personnes et le document sont préremplis. */
      await page.evaluate(() => window.__proofAssocTest.openRevision());
      await page.waitForFunction(() => document.getElementById("genealogyContributionDialog").open);
      let state = await page.evaluate(() => window.__proofAssocTest.formState());
      assert.equal(state.type, "proof", "type de contribution réglé sur preuve");
      assert.deepEqual(state.personChips, ["Ada Alpha", "Grace Beta"], "les deux personnes sont préremplies");
      assert.deepEqual(state.documentChips, ["Registre 1901"], "le document d'origine est prérempli");

      /* 2. Retrait UI complet : toutes les personnes + le document. */
      await page.evaluate(() => {
        const test = window.__proofAssocTest;
        test.removePerson("person-b");
        test.removePerson("person-a");
        test.removeDocument("doc-1");
      });
      state = await page.evaluate(() => window.__proofAssocTest.formState());
      assert.deepEqual(state.personChips, [], "aucune pastille personne après retrait");
      assert.deepEqual(state.documentChips, [], "aucune pastille document après retrait");

      /* 3. Payload de révision réellement vidé, preuve toujours valide. */
      const emptied = await page.evaluate(() => window.__proofAssocTest.savePayload());
      assert.deepEqual(emptied.personIds, [], "personIds vide persisté (preuve sans personne)");
      assert.equal(emptied.documentId, null, "documentId null persisté (preuve sans document)");
      assert.equal(emptied.pageId, null, "pageId null sans document");
      assert.equal(emptied.valid, true, `la preuve vidée reste valide : ${emptied.errors.join(" ; ")}`);

      /* 4. Retrait partiel : une seule personne retirée, l'autre persiste. */
      await page.evaluate(() => {
        const test = window.__proofAssocTest;
        test.openRevision();
      });
      await page.waitForFunction(() => document.getElementById("genealogyContributionDialog").open);
      await page.evaluate(() => window.__proofAssocTest.removePerson("person-b"));
      const partial = await page.evaluate(() => window.__proofAssocTest.savePayload());
      assert.deepEqual(partial.personIds, ["person-a"], "seule la personne retirée disparaît du payload");
      assert.equal(partial.documentId, "doc-1", "le document non touché est conservé");

      /* 5. Réouverture sur une preuve déjà vidée (état post-enregistrement) :
         le formulaire ne réintroduit ni personne ni document. */
      await page.evaluate(() => window.__proofAssocTest.emptyProofAndReopen());
      await page.waitForFunction(() => document.getElementById("genealogyContributionDialog").open);
      const reopened = await page.evaluate(() => window.__proofAssocTest.formState());
      assert.deepEqual(reopened.personChips, [], "la réouverture ne réintroduit aucune personne retirée");
      assert.deepEqual(reopened.documentChips, [], "la réouverture ne réintroduit aucun document retiré");

      assert.deepEqual(pageErrors, [], `erreurs JavaScript : ${pageErrors.join(" | ")}`);
    } finally {
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    await server.close();
  }
});
