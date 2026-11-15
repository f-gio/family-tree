import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { planParentDissociation, dissociationConfirmationMessage } from "../js/family-dissociation.js";
import { normalizedParentChildLinks, parentChildLinkType } from "../js/family-relations.js";
import { validateFamilyDataset } from "../js/backup-utils.js";

const root = new URL("../", import.meta.url);
const [html, css, app] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("css/design-system.css", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8")
]);

const dialog = html.match(/<dialog[^>]*id="familyDetailsDialog"[\s\S]*?<\/dialog>/)?.[0] || "";

test("lot 2 : la modale familiale reprend les dimensions et le pattern de la modale d'attestation", () => {
  assert.match(dialog, /class="person-dialog modal-xl modal-mobile-sheet modal-mobile-sheet--form"/, "même variante de modale que l'attestation");
  assert.match(html, /<dialog class="person-dialog modal-xl[^\"]*" id="personAttestationDialog"/, "référence d'attestation inchangée");
  assert.ok(dialog.includes('class="modal-head"'), "en-tête fixe conservé");
  assert.ok(dialog.includes('class="modal-body modal-form"'), "corps formulaire conservé");
  assert.ok(dialog.includes('class="modal-scroll"'), "zone centrale défilable conservée");
  assert.ok(dialog.includes('class="modal-actions modal-form-actions"'), "pied de modale fixe conservé");
});

test("lot 2 : trois sections clairement séparées, chacune avec son panneau beige", () => {
  const sections = [...dialog.matchAll(/<section class="family-detail-section[^"]*">[\s\S]*?<\/section>/g)].map(match => match[0]);
  assert.equal(sections.length, 3, "Union, Fin de relation et Liens");
  for (const section of sections) assert.ok(section.includes('class="family-detail-panel"'), "chaque section contient un panneau");
  assert.match(sections[0], /<h4>Union<\/h4>/);
  assert.match(sections[1], /<h4>Fin de relation<\/h4>/);
  assert.match(sections[2], /<h4 id="filiationDetailsTitle">/);
  assert.match(html, /id="endDetailsFields" hidden/);
  assert.match(html, /id="filiationEditors"/);
  assert.match(css, /\.family-detail-panel \{[^}]*border: var\(--border-subtle\)/);
  assert.match(css, /\.family-detail-panel \{[^}]*border-radius: var\(--radius-lg\)/);
  assert.match(css, /\.family-detail-panel \{[^}]*background: color-mix\(in srgb, var\(--color-surface-soft\) 72%, transparent\)/);
  assert.match(css, /\.family-detail-section h4 \{[^}]*font: var\(--weight-semibold\) var\(--text-lg\)\/1\.25 var\(--font-display\)/, "titre serif foncé");
  assert.match(css, /\.family-detail-section \+ \.family-detail-section \{[^}]*border-top: var\(--border-subtle\)/, "séparateurs fins beige");
});

test("lot 2 : le sélecteur de dates et les liens restent lisibles sur mobile", () => {
  assert.match(css, /\.family-detail-panel \.date-type-switch \{[^}]*flex-wrap: wrap/, "options du sélecteur de dates sur plusieurs lignes");
  assert.match(css, /\.family-detail-panel \.date-type-switch \{[^}]*overflow-x: visible/, "aucun débordement interne du sélecteur");
  assert.match(css, /\.filiation-editor \{[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(11rem, 0\.6fr\) auto/, "nom, filiation et action sur desktop");
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.filiation-editor,\r?\n\s*\.filiation-editor--child \{[^}]*grid-template-columns: minmax\(0, 1fr\)/, "carte empilée sur mobile");
  assert.match(css, /\.filiation-editor \.filiation-dissociate \{[^}]*min-height: var\(--control-touch\)/, "cible tactile ≥ 44 px");
  assert.match(css, /\.filiation-editor \.filiation-type \.field \{ width: 100%/);
});

test("lot 2 : dissociation individuelle câblée avec confirmation explicite", () => {
  assert.match(app, /data-dissociate-parent/);
  assert.match(app, /dissociationConfirmationMessage\(nameOf\(parentId\), nameOf\(childId\)\)/);
  assert.match(app, /if \(!confirm\(dissociationConfirmationMessage/);
  assert.match(app, /async function applyParentDissociation\(plan\) \{[\s\S]*?writeBatch\(db\)[\s\S]*?batch\.commit\(\);/);
  assert.match(app, /planParentDissociation\(family, parentId, childId\)/);
  assert.match(app, /toast\("Lien de filiation dissocié"\);\s*\$\("familyDetailsDialog"\)\.close\(\);/);
  /* Le bouton de groupe existant de la fiche Personne reste intact. */
  assert.match(app, /data-remove-child="\$\{esc\(family\.id\)\}"/);
  assert.match(app, /Ses liens avec les deux parents seront retirés/);
  assert.match(app, /\[data-remove-partner\],\[data-remove-child\]/);
});

test("lot 2 : la dissociation préserve l'union, l'autre parent et les types de filiation", () => {
  const family = {
    id: "f1",
    partnerIds: ["pere", "mere"],
    childIds: ["enfant1", "enfant2"],
    relationType: "marriage",
    unionDateInfo: { type: "year", year: 1920 },
    unionPlace: "Orino",
    endType: "none",
    endDateInfo: { type: "unknown" },
    parentChildLinks: [
      { parentId: "pere", childId: "enfant1", type: "biological" },
      { parentId: "pere", childId: "enfant2", type: "biological" },
      { parentId: "mere", childId: "enfant1", type: "adoptive" },
      { parentId: "mere", childId: "enfant2", type: "biological" }
    ]
  };
  const plan = planParentDissociation(family, "pere", "enfant1");
  assert.equal(plan.ok, true);
  assert.equal(plan.familyId, "f1");

  /* Foyer d'origine : l'union et l'autre enfant restent, seul le lien retiré disparaît. */
  assert.deepEqual(plan.familyUpdate.childIds, ["enfant2"]);
  assert.deepEqual(
    plan.familyUpdate.parentChildLinks.map(link => `${link.parentId}:${link.childId}:${link.type}`),
    ["pere:enfant2:biological", "mere:enfant2:biological"],
    "les types des liens conservés ne changent pas"
  );

  /* Nouveau foyer monoparental : l'autre parent garde l'enfant et sa filiation. */
  assert.deepEqual(plan.newFamily.partnerIds, ["mere"]);
  assert.deepEqual(plan.newFamily.childIds, ["enfant1"]);
  assert.deepEqual(plan.newFamily.parentChildLinks, [{ parentId: "mere", childId: "enfant1", type: "adoptive" }]);
  assert.equal(plan.newFamily.relationType, "unknown");
  assert.deepEqual(plan.newFamily.unionDateInfo, { type: "unknown" }, "aucune union fabriquée pour le foyer monoparental");
  assert.equal(plan.newFamily.endType, "none");
  assert.equal("marriageAttestations" in plan.newFamily, false, "les attestations d'union restent sur le foyer d'origine");

  /* Le couple n'est pas modifié : même identifiant, mêmes données d'union. */
  assert.equal(family.relationType, "marriage");
  assert.deepEqual(family.unionDateInfo, { type: "year", year: 1920 });
});

test("lot 2 : le scindage reste valide pour la sauvegarde et la restauration", () => {
  const people = [
    { id: "pere", firstName: "Giovanni", lastName: "Rossi" },
    { id: "mere", firstName: "Maria", lastName: "Conti" },
    { id: "enfant1", firstName: "Lina", lastName: "Rossi" },
    { id: "enfant2", firstName: "Enzo", lastName: "Rossi" }
  ];
  const family = {
    id: "f1",
    partnerIds: ["pere", "mere"],
    childIds: ["enfant1", "enfant2"],
    relationType: "marriage",
    unionDateInfo: { type: "year", year: 1920 },
    unionPlace: "Orino",
    endType: "none",
    endDateInfo: { type: "unknown" },
    endPlace: "",
    parentChildLinks: [
      { parentId: "pere", childId: "enfant1", type: "biological" },
      { parentId: "pere", childId: "enfant2", type: "biological" },
      { parentId: "mere", childId: "enfant1", type: "adoptive" },
      { parentId: "mere", childId: "enfant2", type: "biological" }
    ]
  };
  const plan = planParentDissociation(family, "pere", "enfant1");
  const after = { ...family, ...plan.familyUpdate, parentChildLinks: plan.familyUpdate.parentChildLinks };
  const created = { id: "f2", ...plan.newFamily };
  validateFamilyDataset(people, [after, created]);
  assert.equal(normalizedParentChildLinks(after).some(link => link.parentId === "pere" && link.childId === "enfant1"), false);
  assert.equal(parentChildLinkType(created, "mere", "enfant1"), "adoptive");
  assert.equal(parentChildLinkType(after, "pere", "enfant2"), "biological");
});

test("lot 2 : foyer monoparental — l'enfant quitte le foyer sans foyer de rechange", () => {
  const family = {
    id: "f1",
    partnerIds: ["mere"],
    childIds: ["enfant1"],
    relationType: "unknown",
    unionDateInfo: { type: "unknown" },
    endType: "none",
    endDateInfo: { type: "unknown" },
    parentChildLinks: [{ parentId: "mere", childId: "enfant1", type: "biological" }]
  };
  const plan = planParentDissociation(family, "mere", "enfant1");
  assert.equal(plan.ok, true);
  assert.equal(plan.newFamily, null, "aucun foyer créé sans parent restant");
  assert.deepEqual(plan.familyUpdate.childIds, []);
  assert.deepEqual(plan.familyUpdate.parentChildLinks, []);
});

test("lot 2 : garde-fous de la dissociation", () => {
  const family = { id: "f1", partnerIds: ["pere", "mere"], childIds: ["enfant1"] };
  assert.equal(planParentDissociation(family, "inconnu", "enfant1").ok, false);
  assert.equal(planParentDissociation(family, "pere", "inconnu").ok, false);
  assert.equal(planParentDissociation(family, "pere", "pere").ok, false);
  assert.equal(planParentDissociation({}, "pere", "enfant1").ok, false);
  assert.match(dissociationConfirmationMessage("Giovanni Rossi", "Lina Rossi"), /Dissocier Giovanni Rossi de Lina Rossi \?/);
  assert.match(dissociationConfirmationMessage("Giovanni Rossi", "Lina Rossi"), /Seul leur lien de filiation sera retiré/);
  assert.match(dissociationConfirmationMessage("a", "b"), /restent enregistrés/);
});

console.log("Modales familiales et dissociation (lot 2) : OK");
