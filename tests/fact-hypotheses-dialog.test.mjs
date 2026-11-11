// Fumée du dialogue « Gérer les hypothèses » (lot 2C.5-A) : rendu, repli,
// association, changement de rôle et retrait des attestations — le store est
// stubé dans le flux servi pour que ce test n'écrive JAMAIS dans Firestore.
import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { blockedServiceFor, isAllowedRequest, ROOT, startStaticServer } from "./helpers.mjs";

const STORE_LINE = 'const factHypothesesStore = createFactHypothesesStore(db, { doc, collection, query, where, getDocs, runTransaction, serverTimestamp, deleteField });';
const STORE_STUB = 'const factHypothesesStore = { attachAttestation: async input => { window.__fhOps.push(input); const hyp = factHypotheses.find(item => item.id === input.hypothesisId); const attestations = [...(hyp.attestations || [])]; const index = attestations.findIndex(item => item.attestationId === input.attestationId); if (input.remove) { if (index >= 0) attestations.splice(index, 1); } else if (index >= 0) { attestations[index] = { attestationId: input.attestationId, role: input.role }; } else { attestations.push({ attestationId: input.attestationId, role: input.role }); } hyp.attestations = attestations; return { updated: [{ ...hyp }] }; }, reexamineHypothesis: async input => { window.__fhOps.push({ op: "reexamine", ...input }); const hyp = factHypotheses.find(item => item.id === input.hypothesisId); hyp.status = "alternative"; hyp.justification = input.justification; return { updated: [{ ...hyp }] }; } };';

const hooks = `
window.__fhOps = [];
window.__fhSmoke = {
  seed() {
    people = [{
      id: "p-smoke", firstName: "Ada", lastName: "Rossi",
      birthDateInfo: { type: "exact", value: "1869-09-13" },
      birthAttestations: [
        { id: "att-1", date: { type: "exact", value: "1869-09-13" }, comment: "Acte consulté", documentIds: [], sourceIds: [], proofIds: [] },
        { id: "att-2", date: { type: "year", year: 1870 }, comment: "Recensement", documentIds: [], sourceIds: [], proofIds: [] }
      ]
    }];
    factHypotheses = [
      { id: "h1", personId: "p-smoke", fieldKey: "birth.date", status: "retained", initialFromFiche: true,
        value: { type: "exact", value: "1869-09-13" }, justification: "",
        attestations: [{ attestationId: "att-1", role: "supports" }, { attestationId: "att-missing", role: "contradicts" }] },
      { id: "h2", personId: "p-smoke", fieldKey: "birth.date", status: "alternative", initialFromFiche: false,
        value: { type: "year", year: 1872 }, justification: "", attestations: [] },
      { id: "h3", personId: "p-smoke", fieldKey: "birth.date", status: "rejected", initialFromFiche: false,
        value: { type: "year", year: 1868 }, justification: "Source non probante", attestations: [] }
    ];
    factHypothesesState = "ready";
    syncFactHypothesesAvailability();
  },
  open() { openFactHypothesesDialog("birth.date", "p-smoke"); },
  attestations(id) {
    const hyp = factHypotheses.find(item => item.id === id);
    return hyp ? hyp.attestations : null;
  },
  hypothesis(id) {
    const hyp = factHypotheses.find(item => item.id === id);
    return hyp ? { id: hyp.id, status: hyp.status, justification: hyp.justification, value: hyp.value } : null;
  }
};`;

async function openHarness(t, width) {
  const server = await startStaticServer(ROOT);
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { await server.close(); t.skip(`Chromium indisponible : ${error.message}`); return null; }
  const context = await browser.newContext({ viewport: { width, height: 850 }, locale: "fr-FR", isMobile: width <= 760, hasTouch: width <= 760 });
  await context.addInitScript(() => { window.__forcedEnv = "recette"; });
  await context.route("**/*", async route => {
    const url = route.request().url();
    if (new URL(url).pathname.endsWith("/js/app.js")) {
      const response = await route.fetch();
      let source = await response.text();
      assert.ok(source.includes(STORE_LINE), "la ligne de création du store doit être présente");
      source = source
        .replace(STORE_LINE, STORE_STUB)
        .replaceAll('const actorUid = auth.currentUser?.uid || "";', 'const actorUid = "smoke-uid";');
      return route.fulfill({ response, body: `${source}\n${hooks}` });
    }
    if (isAllowedRequest(url, server.baseURL)) return route.continue().catch(() => {});
    if (blockedServiceFor(url)) return route.abort("blockedbyclient").catch(() => {});
    return route.continue().catch(() => {});
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  try {
    await page.goto(server.baseURL, { waitUntil: "load" });
    await page.waitForFunction(() => typeof window.__fhSmoke === "object");
    return { page, context, browser, server, pageErrors };
  } catch (error) {
    await context.close(); await browser.close(); await server.close();
    throw error;
  }
}

test("dialogue : association, rôle et retrait des attestations sans écriture Firestore", async t => {
  const h = await openHarness(t, 1024);
  if (!h) return;
  const { page, context, browser, server, pageErrors } = h;
  try {
    await page.evaluate(() => window.__fhSmoke.seed());
    await page.evaluate(() => window.__fhSmoke.open());
    assert.equal(await page.evaluate(() => document.getElementById("factHypothesesDialog").open), true);
    assert.equal(await page.locator("#factHypothesesTitle").textContent(), "Hypothèses — Date de naissance");

    /* Zone repliée par défaut : la liste des hypothèses reste légère. */
    assert.equal(await page.locator(".fact-hypothesis-attestation-list").count(), 0, "aucune liste dépliée au premier rendu");
    const toggles = page.locator('[data-fact-hypothesis-action="toggle-attestations"]');
    assert.equal(await toggles.count(), 3, "un bouton par hypothèse");
    assert.match(await toggles.first().textContent(), /Attestations \(2\)/);

    await toggles.first().click();
    assert.equal(await page.locator(".fact-hypothesis-attestation-list").count(), 1);
    const rows = page.locator(".fact-hypothesis-attestation");
    assert.equal(await rows.count(), 2, "association existante + référence introuvable");

    /* Ligne existante : rôle, contenu de l'attestation, contrôles. */
    const first = rows.first();
    assert.match(await first.textContent(), /Appuie/);
    assert.match(await first.textContent(), /13 septembre 1869/);
    assert.match(await first.textContent(), /Acte consulté/);
    const roleSelect = first.locator("[data-fh-attestation-role]");
    assert.equal(await roleSelect.inputValue(), "supports");
    assert.equal(await roleSelect.locator("option").count(), 3, "Appuie, Contredit, Contexte");

    /* Référence introuvable : signalée, jamais effacée. */
    const missing = rows.nth(1);
    assert.match(await missing.textContent(), /Attestation introuvable/);
    assert.match(await missing.textContent(), /Référence conservée : att-missing/);
    assert.match(await missing.textContent(), /Contredit/);

    /* Association : seule l'attestation non rattachée est proposée. */
    const pick = page.locator("[data-fh-attestation-pick]");
    assert.equal(await pick.locator("option").count(), 1, "att-1 déjà associée, att-missing hors pool");
    assert.match(await pick.inputValue(), /att-2/);
    await page.locator('[data-fact-hypothesis-action="attestation-add"]').click();
    await page.waitForFunction(() => window.__fhOps.length === 1);
    let op = await page.evaluate(() => window.__fhOps[0]);
    assert.equal(op.attestationId, "att-2");
    assert.equal(op.role, "supports");
    assert.equal(op.actorUid, "smoke-uid");
    assert.equal(op.fieldKey, "birth.date");
    assert.match(await page.locator(".fact-hypothesis-attestation-list").textContent(), /Toutes les attestations de ce fait sont déjà associées/);

    /* Changement de rôle : remplace l'association existante. */
    await page.locator("[data-fh-attestation-role]").first().selectOption("contradicts");
    await page.waitForFunction(() => window.__fhOps.length === 2);
    op = await page.evaluate(() => window.__fhOps[1]);
    assert.equal(op.attestationId, "att-1");
    assert.equal(op.role, "contradicts");
    assert.match(await page.locator(".fact-hypothesis-attestation").first().textContent(), /Contredit/);
    const associationCount = await page.evaluate(() => window.__fhSmoke.attestations("h1").length);
    assert.equal(associationCount, 3, "le changement de rôle n'a jamais créé de doublon");

    /* Retrait : l'association disparaît, l'attestation reste proposée. */
    await page.locator('[data-fact-hypothesis-action="attestation-remove"]').nth(1).click();
    await page.waitForFunction(() => window.__fhOps.length === 3);
    op = await page.evaluate(() => window.__fhOps[2]);
    assert.equal(op.remove, true);
    assert.equal(op.attestationId, "att-missing");
    assert.equal(await page.locator(".fact-hypothesis-attestation").count(), 2, "att-1, att-2 après retrait de la référence introuvable");

    /* Réexamen : action réservée aux hypothèses écartées, justification
       obligatoire, aucune saisie de valeur, conservation de la fiche. */
    const reexamineButtons = page.locator('[data-fact-hypothesis-action="reexamine"]');
    assert.equal(await reexamineButtons.count(), 1, "seule la ligne écartée propose « Réexaminer »");
    await reexamineButtons.click();
    assert.match(await page.locator("#factHypothesesValueForm h4").textContent(), /Réexaminer cette hypothèse/);
    assert.equal(await page.locator("#factHypothesesValueForm .genealogy-date").count(), 0, "aucune saisie de valeur pendant le réexamen");
    const justification = page.locator("#hypoJustification");
    assert.equal(await justification.getAttribute("required"), "", "justification obligatoire");

    /* Soumission vide bloquée par la validation native, avant tout appel store. */
    await page.locator('#factHypothesesValueForm button[type="submit"]').click();
    assert.equal(await page.evaluate(() => window.__fhOps.filter(item => item.op === "reexamine").length), 0);
    assert.equal(await justification.evaluate(element => element.matches(":invalid")), true);

    await justification.fill("Second acte retrouvé");
    await page.locator('#factHypothesesValueForm button[type="submit"]').click();
    await page.waitForFunction(() => window.__fhOps.some(item => item.op === "reexamine"));
    op = await page.evaluate(() => window.__fhOps.find(item => item.op === "reexamine"));
    assert.equal(op.hypothesisId, "h3");
    assert.equal(op.justification, "Second acte retrouvé");
    assert.equal(op.actorUid, "smoke-uid");
    assert.equal(await page.evaluate(() => window.__fhSmoke.hypothesis("h3").status), "alternative");
    assert.deepEqual(await page.evaluate(() => window.__fhSmoke.hypothesis("h3").value), { type: "year", year: 1868 }, "valeur conservée");
    assert.equal(await page.locator('[data-fact-hypothesis-action="reexamine"]').count(), 0, "l'action disparaît hors du statut écartée");

    /* Repli : la zone se referme sans altérer les associations. */
    await page.locator('[data-fact-hypothesis-action="toggle-attestations"]').first().click();
    assert.equal(await page.locator(".fact-hypothesis-attestation-list").count(), 0);
    assert.equal(await page.locator('[data-fact-hypothesis-action="toggle-attestations"]').first().getAttribute("aria-expanded"), "false");

    /* Aucune écriture Firestore : le stub ne touche qu'à la mémoire locale. */
    assert.equal(await page.evaluate(() => window.__fhOps.every(item => item.actorUid === "smoke-uid")), true);
    assert.deepEqual(pageErrors, []);
  } finally { await context.close(); await browser.close(); await server.close(); }
});

test("dialogue mobile : feuille conservée, contrôles ≥ 44 px, sans débordement horizontal", async t => {
  const h = await openHarness(t, 390);
  if (!h) return;
  const { page, context, browser, server, pageErrors } = h;
  try {
    await page.evaluate(() => window.__fhSmoke.seed());
    await page.evaluate(() => window.__fhSmoke.open());
    await page.locator('[data-fact-hypothesis-action="toggle-attestations"]').first().click();

    const metrics = await page.evaluate(() => {
      const dialog = document.getElementById("factHypothesesDialog");
      const content = document.getElementById("factHypothesesContent");
      const select = document.querySelector("[data-fh-attestation-role]");
      const button = document.querySelector('[data-fact-hypothesis-action="attestation-remove"]');
      const box = dialog.getBoundingClientRect();
      return {
        open: dialog.open,
        fullSheet: box.width === window.innerWidth && Math.abs(box.bottom - window.innerHeight) <= 1,
        overflow: content.scrollWidth - content.clientWidth,
        selectMinHeight: Math.round(select.getBoundingClientRect().height),
        buttonHeight: Math.round(button.getBoundingClientRect().height)
      };
    });
    assert.equal(metrics.open, true);
    assert.equal(metrics.fullSheet, true, "feuille pleine largeur ancrée en bas");
    assert.ok(metrics.overflow <= 1, `pas de débordement horizontal (${metrics.overflow}px)`);
    assert.ok(metrics.selectMinHeight >= 44, `sélection de rôle ≥ 44 px (${metrics.selectMinHeight}px)`);
    assert.ok(metrics.buttonHeight >= 44, `bouton Retirer ≥ 44 px (${metrics.buttonHeight}px)`);

    /* Réexamen mobile : bouton de ligne et soumission ≥ 44 px, feuille stable. */
    const mobileReexamine = page.locator('[data-fact-hypothesis-action="reexamine"]');
    assert.equal(await mobileReexamine.count(), 1, "action présente sur la ligne écartée");
    const reexamineBox = await mobileReexamine.boundingBox();
    assert.ok(reexamineBox && reexamineBox.height >= 44, `bouton Réexaminer ≥ 44 px (${reexamineBox?.height}px)`);
    await mobileReexamine.click();
    const submitBox = await page.locator('#factHypothesesValueForm button[type="submit"]').boundingBox();
    assert.ok(submitBox && submitBox.height >= 44, `soumission Réexaminer ≥ 44 px (${submitBox?.height}px)`);
    const formOverflow = await page.evaluate(() => {
      const content = document.getElementById("factHypothesesContent");
      return content.scrollWidth - content.clientWidth;
    });
    assert.ok(formOverflow <= 1, `pas de débordement avec le formulaire de réexamen (${formOverflow}px)`);
    assert.deepEqual(pageErrors, []);
  } finally { await context.close(); await browser.close(); await server.close(); }
});
