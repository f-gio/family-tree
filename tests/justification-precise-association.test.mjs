import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { AUTH_BOOTSTRAP_PATCH, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

/* R2.2 — « Justificatif précis » dans le formulaire d’attestation :
   cibles R1 du propriétaire, recherche et pagination des documents,
   récapitulatif, puis création groupée de Preuves (une par couple
   fait × document) sans recréer une paire déjà présente. */

const hooks = `
window.__preciseProofTest = {
  calls: [],
  writes: [],
  createOfficial(payload) {
    window.__preciseProofTest.calls.push(JSON.parse(JSON.stringify(payload)));
  },
  writeAttestations(kind, attestations) {
    window.__preciseProofTest.writes.push({ kind, attestations: attestations.map(item => ({ ...item })) });
  },
  setRole(role) {
    currentUserProfile = { role, displayName: "Testeur" };
  },
  seed() {
    people = [{
      id: "precise-a", firstName: "Ada", middleName: "", lastName: "Rossi", gender: "F",
      birthDateInfo: { type: "year", year: 1890 }, place: "Palermo", inTree: true
    }];
    families = [];
    documents = [];
    for (let index = 1; index <= 10; index += 1) {
      documents.push({
        id: "precise-doc-" + index,
        title: index === 3 ? "Cadastre communal d’Orino" : "Registre " + index,
        type: "Registre",
        fileName: "registre-" + index + ".pdf",
        mimeType: "application/pdf",
        personIds: ["precise-a"]
      });
    }
    loadedPeople = loadedFamilies = loadedDocuments = loadedTasks = true;
    genealogyRecords = {
      sourceDocuments: [], sourceRevisions: [], transcriptionHeads: [], transcriptionRevisions: [],
      genealogyProofs: [{
        id: "precise-proof-existing",
        data: {
          id: "precise-proof-existing",
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

async function openPreciseAttestation(page) {
  if (await page.locator("#personPageEditHost").isHidden()) {
    await page.locator("#personPageEditBtn").click();
    await page.waitForFunction(() => !document.getElementById("personPageEditHost").hidden, undefined, { timeout: 10000 });
  }
  await page.locator("#birthAttestationControl [data-journey-attestation-add]").click();
  await page.waitForFunction(() => document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
}

test("justificatif précis : cibles, documents, récapitulatif et création groupée", { timeout: 120000 }, async t => {
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
      const proofHook = "genealogyStore.createOfficial(";
      assert.ok(source.includes(proofHook), "création officielle appelable depuis le harnais");
      source = source.split(proofHook).join("window.__preciseProofTest.createOfficial(");
      const attestationHook = 'await updateDoc(doc(db, "people", target.id), { [field]: next });';
      assert.ok(source.includes(attestationHook), "écriture d’attestation appelable depuis le harnais");
      source = source.split(attestationHook).join('await window.__preciseProofTest.writeAttestations(target.kind, next);');
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

    /* Rôle non administrateur : la rubrique existe mais n'offre aucune cible. */
    await page.evaluate(() => window.__preciseProofTest.setRole("member"));
    await openPreciseAttestation(page);
    assert.match(await page.locator("#personAttestationDialog").innerText(), /réservée aux administrateurs/, "création réservée aux administrateurs");
    assert.equal(await page.locator("[data-journey-proof-section]").count(), 0, "aucun sélecteur pour un rôle non administrateur");
    await page.locator("#closePersonAttestationDialogBtn").click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });
    await page.evaluate(() => window.__preciseProofTest.setRole("admin"));

    await openPreciseAttestation(page);
    assert.equal(await page.locator("[data-journey-proof-section]").count(), 1, "rubrique Justificatif précis présente");
    assert.ok(await page.locator("[data-journey-proof-target]").count() >= 6, "cibles R1 de la Personne publiées");
    assert.equal(await page.locator("[data-journey-proof-relation] option").count(), 4, "quatre relations documentaires");
    assert.equal(await page.locator("[data-journey-proof-relation]").inputValue(), "supports", "relation neutre par défaut");
    assert.match(await page.locator("[data-journey-proof-recap]").innerText(), /Sélectionnez au moins un fait précis et un document/);

    /* Pagination puis recherche des documents. */
    assert.equal(await page.locator("[data-journey-proof-document]").count(), 8, "première page de documents");
    assert.match(await page.locator('[data-journey-proof-more="document"]').innerText(), /Afficher plus \(2\)/);
    await page.locator('[data-journey-proof-more="document"]').click();
    assert.equal(await page.locator("[data-journey-proof-document]").count(), 10, "page suivante ajoutée sans perdre la sélection");
    await page.fill("#journeyProofDocumentSearch", "Cadastre");
    assert.equal(await page.locator("[data-journey-proof-document]").count(), 1, "recherche document filtrée");
    assert.equal(await page.locator('[data-journey-proof-document="precise-doc-3"]').count(), 1, "document trouvé par son titre");
    await page.fill("#journeyProofDocumentSearch", "");
    assert.equal(await page.locator("[data-journey-proof-document]").count(), 8, "pagination repart à la première page");

    /* Recherche des cibles. */
    await page.fill("#journeyProofTargetSearch", "naissance");
    assert.ok(await page.locator("[data-journey-proof-target]").count() >= 2, "cibles de naissance filtrées");
    await page.fill("#journeyProofTargetSearch", "");
    assert.ok(await page.locator("[data-journey-proof-target]").count() >= 6, "liste des cibles restaurée");

    /* Sélection : 1 fait × 2 documents, dont une paire déjà portée. */
    await page.locator('[data-journey-proof-target="fact~person~precise-a~birth.date"]').check();
    assert.match(await page.locator("[data-journey-proof-recap]").innerText(), /Sélectionnez au moins un fait précis et un document/);
    await page.locator('[data-journey-proof-document="precise-doc-1"]').check();
    assert.match(await page.locator("[data-journey-proof-recap]").innerText(), /1 fait × 1 document → 1 Preuve à créer/);
    await page.locator('[data-journey-proof-document="precise-doc-2"]').check();
    assert.match(await page.locator("[data-journey-proof-recap]").innerText(), /1 fait × 2 documents → 2 Preuves à créer/);

    /* Enregistrement : date obligatoire, puis création groupée. */
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    assert.ok(await page.locator("#journeyError-attDate").isVisible(), "date de l’attestation obligatoire");
    assert.deepEqual(await page.evaluate(() => window.__preciseProofTest.calls), [], "aucune Preuve sans enregistrement valide");
    await page.locator('#personAttestationDialog [data-journey-date-type="year"]').click();
    await page.fill("#journeyDateYear", "1890");
    await page.locator('#personAttestationDialog [data-journey-attestation-save]').click();
    await page.waitForFunction(() => !document.getElementById("personAttestationDialog").open, undefined, { timeout: 10000 });

    const calls = await page.evaluate(() => window.__preciseProofTest.calls);
    assert.equal(calls.length, 1, "la paire déjà portée n’est pas recréée, l’autre est créée");
    assert.equal(calls[0].type, "proof");
    assert.equal(calls[0].data.factId, "fact~person~precise-a~birth.date");
    assert.equal(calls[0].data.factType, "person.birth.date");
    assert.equal(calls[0].data.documentId, "precise-doc-2");
    assert.deepEqual([...calls[0].data.personIds].sort(), ["precise-a"]);
    assert.equal(calls[0].data.relation, "supports");
    assert.equal(calls[0].data.familyId ?? null, null);
    assert.equal(calls[0].data.sourceValue ?? null, null, "aucune valeur de fait inventée");
    assert.equal(typeof calls[0].id, "string");
    assert.equal(calls[0].id.length > 0, true);

    const writes = await page.evaluate(() => window.__preciseProofTest.writes);
    assert.equal(writes.length, 1, "attestation de naissance enregistrée");
    assert.equal(writes[0].kind, "birth");
    assert.deepEqual(errors, [], "aucune erreur JavaScript");
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }
});
