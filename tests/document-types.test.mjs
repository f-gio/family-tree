import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";
import {
  DOCUMENT_TYPE_GROUPS,
  DOCUMENT_TYPE_VALUES,
  DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL,
  isDocumentTypeValue,
  documentTypeLabel,
  documentTypeOptionsMarkup,
  documentTypeFilterOptionsMarkup,
  documentTypeHistoricalValues
} from "../js/document-types.js";

const read = relative => readFile(new URL(relative, import.meta.url), "utf8");

function optionValues(markup) {
  return [...markup.matchAll(/<option[^>]*value="([^"]*)"/g)].map(match => match[1]);
}

function optionGroups(markup) {
  return [...markup.matchAll(/<optgroup label="([^"]*)"/g)].map(match => match[1]);
}

function selectedValues(markup) {
  return [...markup.matchAll(/<option[^>]*value="([^"]*)"[^>]*\bselected\b/g)].map(match => match[1]);
}

test("les catégories et les valeurs de documents suivent le formalisme imposé", () => {
  assert.deepEqual(DOCUMENT_TYPE_GROUPS.map(group => group.label), [
    "État civil",
    "Registre paroissial",
    "Document militaire",
    "Recensement",
    "Document notarial",
    "Document immobilier",
    "Document cadastral",
    "Document administratif",
    "Immigration et émigration",
    "Document judiciaire",
    "Document professionnel",
    "Document scolaire",
    "Photographie",
    "Correspondance",
    "Presse",
    "Carte et plan",
    "Autre"
  ], "ordre des catégories respecté");
  assert.deepEqual(DOCUMENT_TYPE_GROUPS.at(-1).values, ["Autre"], "« Autre » reste en dernière position et seul");
  const values = DOCUMENT_TYPE_VALUES;
  assert.equal(values.length, new Set(values).size, "aucune valeur dupliquée");
  assert.ok(values.includes("Transaction immobilière"), "valeurs métier présentes");
  assert.ok(!values.includes("Document immobilier"), "la catégorie n’est jamais une valeur sélectionnable");
  for (const group of DOCUMENT_TYPE_GROUPS) {
    for (const value of group.values) assert.equal(isDocumentTypeValue(value), true, `${value} reconnue`);
  }
  assert.equal(isDocumentTypeValue("Photo"), false, "une valeur historique hors liste n’est pas une valeur canonique");
});

test("le sélecteur du formulaire groupe les valeurs sans jamais sélectionner une catégorie", () => {
  const markup = documentTypeOptionsMarkup();
  assert.equal(markup.startsWith(`<option value="">Sélectionner…</option>`), true, "placeholder de création");
  assert.deepEqual(optionGroups(markup), DOCUMENT_TYPE_GROUPS.map(group => group.label), "catégories dans l’ordre, en optgroup non sélectionnable");
  const values = optionValues(markup);
  assert.equal(values[0], "", "placeholder en première position");
  assert.deepEqual(values.slice(1), [...DOCUMENT_TYPE_VALUES], "valeurs exactement dans l’ordre des catégories");
  for (const value of values.slice(1)) assert.ok(DOCUMENT_TYPE_VALUES.includes(value), `${value} reste une valeur, jamais une catégorie`);
  assert.deepEqual(selectedValues(markup), [], "aucune valeur présélectionnée à la création");
});

test("une valeur enregistrée reste sélectionnable en modification", () => {
  const canonical = documentTypeOptionsMarkup("Transaction immobilière");
  assert.deepEqual(selectedValues(canonical), ["Transaction immobilière"], "valeur canonique sélectionnée dans sa catégorie");
  assert.equal(optionGroups(canonical).includes(DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL), false, "pas de repli inutile pour une valeur canonique");

  const historical = documentTypeOptionsMarkup("Photo");
  assert.deepEqual(selectedValues(historical), ["Photo"], "valeur historique conservée et sélectionnée");
  const groups = optionGroups(historical);
  assert.equal(groups.at(-1), DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL, "repli historique en dernière position, après « Autre »");
  assert.equal(groups.includes("Autre"), true, "les catégories restent proposées à côté du repli");

  assert.equal(documentTypeOptionsMarkup("").includes(DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL), false, "aucun repli sans valeur");
});

test("la valeur sélectionnée constitue à elle seule le type affiché", () => {
  assert.equal(documentTypeLabel("Transaction immobilière"), "Transaction immobilière", "le type est la valeur, jamais la catégorie");
  for (const group of DOCUMENT_TYPE_GROUPS) {
    if (group.label === "Autre") continue;
    assert.ok(!DOCUMENT_TYPE_VALUES.includes(group.label), `${group.label} ne peut jamais remplacer une valeur dans une pastille`);
  }
});

test("le filtre de la liste couvre les valeurs canoniques et les types historiques", () => {
  const markup = documentTypeFilterOptionsMarkup(["Photo", "Registre", "Autre"]);
  assert.equal(markup.startsWith(`<option value="">Tous les types</option>`), true, "« Tous les types » en première position");
  const groups = optionGroups(markup);
  assert.equal(groups[0], DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL, "valeurs historiques regroupées avant les catégories");
  assert.equal(groups.at(-1), "Autre", "« Autre » reste la dernière catégorie du filtre");
  const values = optionValues(markup);
  for (const value of DOCUMENT_TYPE_VALUES) assert.ok(values.includes(value), `${value} filtrable`);
  for (const value of ["Photo", "Registre"]) assert.ok(values.includes(value), `${value} historique toujours filtrable`);
  assert.equal(values.includes("Autre"), true, "« Autre » historique déjà canonique non dupliqué");
  assert.equal(new Set(values).size, values.length, "aucune option dupliquée");

  const withoutHistory = documentTypeFilterOptionsMarkup([]);
  assert.equal(optionGroups(withoutHistory).includes(DOCUMENT_TYPE_HISTORICAL_GROUP_LABEL), false, "aucun groupe vide");
});

test("les types historiques sont dédupliqués et limités aux valeurs hors liste", () => {
  const items = [
    { type: "Photo" },
    { type: "Photo" },
    { type: "  Registre  " },
    { type: "Autre" },
    { type: "Transaction immobilière" },
    { type: "" },
    { type: undefined },
    {}
  ];
  assert.deepEqual(documentTypeHistoricalValues(items), ["Photo", "Registre"], "valeurs hors liste uniquement, espaces nettoyés");
  assert.deepEqual(documentTypeHistoricalValues([]), [], "aucun historique sans documents");
});

test("les deux sélecteurs de la page sont alimentés par la source unique", async () => {
  const [html, app] = await Promise.all([read("../index.html"), read("../js/app.js")]);
  const formSelect = html.match(/<select class="field" id="documentType" required>[\s\S]*?<\/select>/)?.[0] || "";
  const filterSelect = html.match(/<select class="field" id="documentTypeFilter">[\s\S]*?<\/select>/)?.[0] || "";
  assert.ok(formSelect && filterSelect, "les deux sélecteurs existent");
  assert.deepEqual(optionValues(formSelect), [""], "formulaire sans liste codée en dur (aucune source divergente)");
  assert.deepEqual(optionValues(filterSelect), [""], "filtre sans liste codée en dur (aucune source divergente)");
  assert.match(app, /documentTypeOptionsMarkup\(item\?\.type\)/, "le formulaire est reconstruit avec la valeur enregistrée");
  assert.match(app, /documentTypeFilterOptionsMarkup\(historical\)/, "le filtre est reconstruit depuis les valeurs réellement présentes");
  assert.match(app, /import \{ documentTypeOptionsMarkup, documentTypeFilterOptionsMarkup, documentTypeHistoricalValues \} from "\.\/document-types\.js";/, "module unique importé");
});

test("les finitions d’en-tête et de visionneuse sont portées par des règles ciblées", async () => {
  const [html, css, app] = await Promise.all([read("../index.html"), read("../css/design-system.css"), read("../js/app.js")]);
  /* §2 : lien Retour à gauche et pastille du type sur la ligne du titre. */
  assert.match(css, /\.document-detail-return-row \{ display: flex; justify-content: flex-start;/, "Retour de la fiche Document aligné à gauche");
  assert.match(css, /\.document-detail-title-group \{ display: flex;/, "titre + pastille sur une même ligne");
  assert.match(html, /class="btn dedicated-page-back document-detail-back"/, "Retour au format du lien Retour de l’atelier");
  /* §5 : le séparateur sous le document reprend la couleur du séparateur de
     la barre d’outils (le raccourci de bordure était invalide en couleur). */
  assert.match(css, /border-bottom-color: var\(--color-border-subtle\)/, "séparateur de la visionneuse en beige clair");
  assert.doesNotMatch(css, /border-bottom-color: var\(--border-subtle\)/, "raccourci de bordure plus jamais utilisé comme couleur");
  /* §6 : pastille du type dans l’en-tête de l’atelier. */
  assert.match(html, /id="workshopTypeBadge"/, "pastille du type présente dans l’en-tête de l’atelier");
  assert.match(app, /function renderWorkshopTypeBadge\(\)/, "type lu depuis le document existant");
  /* §7.1 : libellé du CTA de consultation selon la largeur d’écran. */
  assert.match(app, /\? "Modifier" : "Modifier la transcription"/, "CTA « Modifier » sur mobile, libellé complet sur desktop");
});
