import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/* R2.2 — Documents justificatifs / Informations concernées :
   sélection documentaire multisélection + recherche de bibliothèque,
   informations explicites (sujet, fait, document, qualification propres),
   aucun produit cartésien, associations existantes chargées sans duplication,
   retrait contrôlé et conservation de l'état à l'ouverture d'un onglet. */

const hooks = `
window.__preciseProofTest = {
  createCalls: [],
  deleteCalls: [],
  writes: [],
  snapshots: [],
  createOfficial(payload) {
    window.__preciseProofTest.createCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  deleteOfficial(payload) {
    window.__preciseProofTest.deleteCalls.push(JSON.parse(JSON.stringify(payload)));
  },
  writeAttestations(kind, attestations) {
    window.__preciseProofTest.writes.push({ kind, attestations: attestations.map(item => ({ ...item })) });
  },
  snapshot(id, data) {
    window.__preciseProofTest.snapshots.push({ id, data: JSON.parse(JSON.stringify(data)) });
  },
  reset() {
    window.__preciseProofTest.createCalls = [];
    window.__preciseProofTest.deleteCalls = [];
    window.__preciseProofTest.writes = [];
    window.__preciseProofTest.snapshots = [];
  },
  seed() {
    people = [
      { id: "precise-a", firstName: "Ada", lastName: "Rossi", gender: "F", inTree: true, birthDateInfo: { type: "year", year: 1890 } },
      { id: "precise-b", firstName: "Bruno", lastName: "Bianchi", gender: "M", inTree: true }
    ];
    families = [{
      id: "precise-family",
      partnerIds: ["precise-a", "precise-b"],
      childIds: [],
      relationType: "marriage",
      unionDateInfo: { type: "year", year: 1912 },
      endType: "none",
      endDateInfo: { type: "unknown" },
      parentChildLinks: []
    }];
    documents = [
      { id: "precise-doc-1", title: "Acte de naissance", type: "Acte", fileName: "acte.pdf", mimeType: "application/pdf", personIds: ["precise-a"] },
      { id: "precise-doc-2", title: "Registre communal", type: "Registre", fileName: "registre.pdf", mimeType: "application/pdf", personIds: ["precise-a"] },
      { id: "precise-doc-3", title: "Photographie de famille", type: "Photo", fileName: "photo.jpg", mimeType: "image/jpeg", personIds: ["precise-a"] },
      { id: "precise-doc-lib", title: "Bibliothèque sans lien", type: "Archive", fileName: "libre.bin", mimeType: "application/octet-stream", personIds: [] }
    ];
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{
        id: "precise-proof-seed",
        data: {
          id: "precise-proof-seed",
          factId: "fact~person~precise-a~birth.date",
          factType: "person.birth.date",
          personIds: ["precise-a"],
          documentId: "precise-doc-1",
          relation: "supports",
          technicalStatus: "active",
          sourceValue: null
        }
      }],
      genealogyProofRevisions: [], factConclusions: [], conclusionRevisions: [],
      genealogyProposals: [], genealogyEvents: [], genealogyNotifications: []
    };
    genealogyLoaded = true;
    genealogyCollectionsLoaded = new Set(["sourceDocuments", "sourceRevisions", "transcriptionHeads", "transcriptionRevisions", "genealogyProofs", "genealogyProofRevisions", "factConclusions", "conclusionRevisions", "genealogyProposals", "genealogyEvents", "genealogyNotifications"]);
    currentUserProfile = { role: "admin", displayName: "Archiviste" };
    treeCatalogState = "ready";
    $("authScreen").hidden = true;
    $("topbar").hidden = false;
    renderTree();
    setView("directory");
  }
};
`;

async function openAttestation(page) {
  if (await page.locator("#personPageEditHost").isHidden()) {
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
  }
  await page.locator("#birthAttestationControl [data-journey-attestation-add]").click();
  await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
}

async function pickDocument(page, id) {
  await page.locator(`#personAttestationDialog [data-journey-document-pick="${id}"]`).evaluate(input => {
    input.checked = true;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("documents justificatifs et informations concernées : associations explicites, sans produit cartésien", { timeout: 120000 }, async t => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { t.skip(`Chromium indisponible : ${error.message}`); return; }
  const server = await startStaticServer(ROOT);
  const context = await browser.newContext({ locale: "fr-FR", viewport: { width: 1280, height: 900 } });
  const errors = [];
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      const createHook = "genealogyStore.createOfficial(";
      const deleteHook = "genealogyStore.deleteOfficial(";
      assert.ok(source.includes(createHook), "création officielle appelable depuis le harnais");
      assert.ok(source.includes(deleteHook), "suppression officielle appelable depuis le harnais");
      source = source.split(createHook).join("window.__preciseProofTest.createOfficial(");
      source = source.split(deleteHook).join("window.__preciseProofTest.deleteOfficial(");
      const attestationHook = 'await updateDoc(doc(db, "people", target.id), { [field]: next });';
      assert.ok(source.includes(attestationHook), "écriture d’attestation appelable depuis le harnais");
      source = source.split(attestationHook).join('await window.__preciseProofTest.writeAttestations(target.kind, next);');
      const snapshotHook = 'await updateDoc(doc(db, "people", id), data);';
      if (source.includes(snapshotHook)) {
        source = source.split(snapshotHook).join('await window.__preciseProofTest.snapshot(id, data);');
      }
      /* Le harnais n'authentifie personne : l'identifiant d'auteur est fourni
         par le banc d'essai, jamais retiré du code de production. */
      const actorHook = 'const actorUid = auth.currentUser?.uid || null;';
      assert.ok(source.includes(actorHook), "identifiant d’auteur des associations appelable depuis le harnais");
      source = source.split(actorHook).join('const actorUid = "precise-test-admin";');
      return route.fulfill({ response, body: `${source}\n${AUTH_BOOTSTRAP_PATCH}\n${hooks}` });
    }
    return isAllowedRequest(url, server.baseURL) || url.includes("gstatic.com")
      ? route.continue().catch(() => {})
      : route.abort("blockedbyclient").catch(() => {});
  });

  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => dialog.accept().catch(() => {}));
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__preciseProofTest === "object");
    await page.evaluate(() => window.__preciseProofTest.seed());
    await page.waitForFunction(() => Boolean(document.querySelector('#directoryList [data-directory-person="precise-a"]')));
    await page.locator('#directoryList [data-directory-person="precise-a"]').click();
    await page.waitForFunction(() => !document.getElementById("personDetailView").hidden, undefined, { timeout: 10000 });

    await openAttestation(page);

    /* Phase E : trois rubriques, aucune date, aucune liste historique de cases
       à cocher, aucune qualification globale. */
    assert.deepEqual(
      await page.locator("#personAttestationDialog .attestation-form-section > h4").allTextContents(),
      ["Documents justificatifs", "Informations concernées", "Commentaire"],
      "structure finale du formulaire"
    );
    assert.equal(await page.locator("#personAttestationDialog [data-journey-date]").count(), 0, "champ Date supprimé");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-source-check]").count(), 0, "sélection de Sources supprimée");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-proof-check]").count(), 0, "longue liste de Preuves supprimée");
    assert.equal(await page.locator("#personAttestationDialog [data-journey-association-relation] option").count(), 4, "qualification par association, non globale");

    /* Phase C : multisélection des documents liés, recherche secondaire. */
    await page.locator("[data-journey-documents-toggle]").click();
    assert.equal(await page.locator("[data-journey-document-pick]").count(), 3, "documents déjà associés à la personne");
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-lib"]').count(), 0, "document de bibliothèque absent par défaut");
    await pickDocument(page, "precise-doc-1");
    await pickDocument(page, "precise-doc-2");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, "affichage compact des documents sélectionnés");
    await page.fill("#journeyDocumentSearch", "bibliothèque");
    assert.equal(await page.locator('[data-journey-document-pick="precise-doc-lib"]').count(), 1, "recherche secondaire dans toute la bibliothèque");
    await page.fill("#journeyDocumentSearch", "");

    /* Phase D : l'association déjà enregistrée est chargée, sans duplication. */
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 1, "association existante chargée une seule fois");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Enregistrée/);
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Confirme/);

    /* Sujet par défaut = fiche courante, jamais une restriction. */
    assert.match(await page.locator("#journeySubjectChosen").innerText(), /Ada Rossi/, "sujet de la fiche suggéré par défaut");
    await page.fill("#journeyAssociationSubjectSearch", "bruno");
    await page.locator('[data-journey-subject-pick="person:precise-b"]').click();
    assert.match(await page.locator("#journeySubjectChosen").innerText(), /Bruno Bianchi/, "recherche d’une autre Personne dans l’arbre");
    assert.ok(await page.locator("#journeyAssociationFact option").count() > 1, "faits disponibles via le registre R1 pour l’autre sujet");
    await page.selectOption("#journeyAssociationFact", { index: 1 });
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    await page.selectOption("#journeyAssociationRelation", "contradicts");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 2, "une information ajoutée");
    assert.match(await page.locator("#journeyAssociationList").innerText(), /Contredit/);

    /* Un couple fait × document déjà présent n'est jamais dupliqué. */
    await page.fill("#journeyAssociationSubjectSearch", "");
    await page.locator('[data-journey-subject-pick="person:precise-a"]').click();
    await page.selectOption("#journeyAssociationDocument", "precise-doc-1");
    const factOptions = await page.locator("#journeyAssociationFact option").evaluateAll(options => options.map(option => ({ value: option.value, label: option.textContent })));
    const birthFact = factOptions.find(option => option.label.includes("Date de naissance"));
    assert.ok(birthFact, "fait « Date de naissance » publié par le registre");
    await page.selectOption("#journeyAssociationFact", birthFact.value);
    await page.locator("[data-journey-association-add]").click();
    assert.match(await page.locator("#journeyError-association").innerText(), /existe déjà/, "doublon refusé");
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 2, "aucune ligne supplémentaire après doublon");

    /* Retrait d'un brouillon : immédiat et sans écriture. */
    const draftKey = await page.locator("#journeyAssociationList .attestation-association-row").last().getAttribute("data-journey-association");
    await page.locator(`[data-journey-association-remove="${draftKey}"]`).click();
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 1, "retrait contrôlé d’un brouillon");
    await page.locator('[data-journey-subject-pick="person:precise-b"]').click();
    await page.selectOption("#journeyAssociationFact", { index: 1 });
    await page.selectOption("#journeyAssociationDocument", "precise-doc-2");
    await page.selectOption("#journeyAssociationRelation", "contradicts");
    await page.locator("[data-journey-association-add]").click();
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 2, "réajout de l’information");

    await page.evaluate(() => window.__preciseProofTest.reset());
    await page.fill("#journeyAttComment", "Registre communal consulté");

    /* Enregistrement : une Preuve par association explicite, aucune combinaison. */
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const createCalls = await page.evaluate(() => window.__preciseProofTest.createCalls);
    assert.equal(createCalls.length, 1, "une seule création : une association explicite, pas un produit cartésien");
    assert.equal(createCalls[0].type, "proof");
    assert.equal(createCalls[0].data.documentId, "precise-doc-2");
    assert.equal(createCalls[0].data.relation, "contradicts", "qualification portée par l’association");
    assert.equal(createCalls[0].data.familyId ?? null, null);
    assert.deepEqual([...createCalls[0].data.personIds].sort(), ["precise-b"]);
    assert.equal(typeof createCalls[0].data.factId, "string");
    assert.equal(typeof createCalls[0].data.factType, "string");
    assert.equal(createCalls[0].data.sourceValue ?? null, null, "aucune valeur de fait inventée");
    const writes = await page.evaluate(() => window.__preciseProofTest.writes);
    assert.equal(writes.length, 1, "attestation de naissance enregistrée");
    assert.equal(writes[0].kind, "birth");
    assert.equal(writes[0].attestations[0].date, null, "aucune date fabriquée");
    assert.deepEqual(writes[0].attestations[0].documentIds, ["precise-doc-1", "precise-doc-2"]);
    assert.deepEqual(writes[0].attestations[0].sourceIds, [], "champ sourceIds préservé, non modifié par le nouveau formulaire");
    assert.deepEqual(writes[0].attestations[0].proofIds, [], "champ proofIds préservé, non modifié par le nouveau formulaire");

    /* Réouverture : documents et associations existantes sont rechargés. */
    await page.locator("#birthAttestationList [data-journey-attestation-edit]").first().click();
    await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 2, "documents restaurés à la réouverture");
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 1, "association existante rechargée sans duplication");
    assert.match(await page.locator("#journeyAttComment").inputValue(), /Registre communal consulté/, "commentaire restauré");

    /* Retrait contrôlé d'une association enregistrée : confirmé puis appliqué
       à l'enregistrement. */
    await page.evaluate(() => window.__preciseProofTest.reset());
    const existingKey = await page.locator("#journeyAssociationList .attestation-association-row").first().getAttribute("data-journey-association");
    await page.locator(`[data-journey-association-remove="${existingKey}"]`).click();
    assert.equal(await page.locator("#journeyAssociationList .attestation-association-row").count(), 0, "association retirée de la liste après confirmation");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 5000 });
    const deleteCalls = await page.evaluate(() => window.__preciseProofTest.deleteCalls);
    assert.equal(deleteCalls.length, 1, "un retrait confirmé, appliqué à l’enregistrement");
    assert.equal(deleteCalls[0].type, "proof");
    assert.equal(deleteCalls[0].id, "precise-proof-seed");

    /* « Voir la fiche » ouvre la fiche Document dans un nouvel onglet, sans
       affecter l'état du formulaire. */
    await openAttestation(page);
    await page.locator("[data-journey-documents-toggle]").click();
    await pickDocument(page, "precise-doc-3");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "document sélectionné avant l’ouverture d’un onglet");
    const popupPromise = page.waitForEvent("popup");
    await page.locator("[data-journey-document-sheet]").first().click();
    const popup = await popupPromise;
    await popup.waitForURL(/view=documentDetail/, { timeout: 15000 });
    assert.match(popup.url(), /id=precise-doc/, "l’identifiant du document porte l’URL");
    await popup.close().catch(() => {});
    assert.equal(await page.locator("#personAttestationDialog").evaluate(dialog => dialog.open), true, "le formulaire reste ouvert après l’onglet");
    assert.equal(await page.locator("#journeyDocumentSelection .attestation-document-chip").count(), 1, "état du formulaire conservé à l’ouverture d’un onglet");

    assert.deepEqual(errors, [], `aucune erreur JavaScript : ${errors.join(" | ")}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
