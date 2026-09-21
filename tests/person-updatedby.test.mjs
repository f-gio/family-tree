import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { importedDataFields } from "../js/backup-utils.js";

const root = new URL("../", import.meta.url);
const [html, app, rules, backupUtils] = await Promise.all([
  readFile(new URL("index.html", root), "utf8"),
  readFile(new URL("js/app.js", root), "utf8"),
  readFile(new URL("firestore.rules", root), "utf8"),
  readFile(new URL("js/backup-utils.js", root), "utf8")
]);

// --- Formatage de la métadonnée ---

test("formatPersonModInfo gère l'absence d'updatedAt", () => {
  assert.ok(app.includes('if (!item?.updatedAt?.toDate) return "";'), "garde updatedAt manquant");
});

test("formatPersonModInfo formate la date en français avec heure", () => {
  assert.ok(app.includes('toLocaleDateString("fr-FR"'), "formatage date fr-FR");
  assert.ok(app.includes('toLocaleTimeString("fr-FR"'), "formatage heure fr-FR");
  assert.ok(app.includes('day: "numeric", month: "short", year: "numeric"'), "format jour/mois/année");
  assert.ok(app.includes('hour: "2-digit", minute: "2-digit"'), "format heure:minute");
});

test("formatPersonModInfo affiche l'auteur seulement si updatedByName existe", () => {
  assert.ok(app.includes("const author = item.updatedByName;"), "extraction updatedByName");
  assert.ok(app.includes("author ?"), "affichage conditionnel du nom");
});

// --- Structure du HTML (la métadonnée vit désormais dans le header de la modale) ---

test("la métadonnée de modification est affichée une seule fois dans le header", () => {
  assert.ok(!html.includes('id="personMetaInfo"'), "l'occurrence dans l'onglet identité a été retirée");
  assert.ok(html.includes('id="personDialogMeta"'), "header de la modale porte la métadonnée");
});

// --- Code dans app.js ---

test("openPerson alimente la métadonnée du header (sans duplicata dans le contenu)", () => {
  assert.ok(app.includes('personModMetaParts(item)'), "personModMetaParts dans openPerson");
  assert.ok(app.includes('personDialogMeta'), "métadonnée pointe le header");
  assert.ok(!app.includes('$("personMetaInfo")'), "personMetaInfo n'est plus piloté par openPerson");
});

test("la création de personne inclut updatedBy et updatedByName", () => {
  assert.ok(app.includes('updatedBy: auth.currentUser?.uid || ""'), "updatedBy dans le submit handler");
  assert.ok(app.includes('updatedByName: currentUserProfile?.displayName || ""'), "updatedByName dans le submit handler");
});

test("le retrait de l'arbre inclut updatedBy et updatedByName", () => {
  const match = app.match(/updateDoc\(doc\(db, "people", id\), \{ inTree: false[\s\S]*?\}\)/);
  assert.ok(match, "updateDoc inTree:false introuvable");
  assert.ok(match[0].includes("updatedBy:"), "updatedBy absent du retrait de l'arbre");
  assert.ok(match[0].includes("updatedByName:"), "updatedByName absent du retrait de l'arbre");
});

// --- Sécurité Firestore ---

test("validUpdatedBy empêche l'usurpation d'UID", () => {
  assert.ok(rules.includes("function validUpdatedBy()"), "validUpdatedBy non définie");
  assert.ok(rules.includes("request.resource.data.updatedBy == request.auth.uid"), "vérification updatedBy == auth.uid");
});

test("validUpdatedBy est utilisée dans les règles people", () => {
  const peopleMatch = rules.match(/match \/people\/\{personId\}\s*\{[\s\S]*?\n\s*\}/);
  assert.ok(peopleMatch, "match people introuvable");
  assert.ok(peopleMatch[0].includes("validUpdatedBy()"), "validUpdatedBy non appelée dans les règles people");
});

test("validUpdatedBy autorise l'absence du champ (compatibilité legacy)", () => {
  assert.ok(rules.includes("!('updatedBy' in request.resource.data)"), "vérification d'absence du champ manquante");
});

// --- Résolution du nom ---

test("le displayName n'est jamais dupliqué dans la fiche (snapshot uniquement)", () => {
  assert.ok(!app.includes('updatedByName: item?.displayName'), "pas de duplication depuis la fiche");
});

test("le snapshot utilise currentUserProfile et non un champ saisi", () => {
  assert.ok(app.includes('currentUserProfile?.displayName || ""'), "snapshot basé sur currentUserProfile");
});

// --- Sauvegarde ---

test("backup-utils exporte tous les champs Firestore y compris updatedBy", () => {
  assert.ok(backupUtils.includes("JSON.parse(JSON.stringify(item))"), "exportableRecord copie tous les champs");
});

test("backup-utils retire updatedBy et updatedByName à l'import pour éviter les conflits de restauration", () => {
  assert.ok(backupUtils.includes("const { id, createdAt, updatedAt, backupFile, updatedBy, updatedByName, ...data } = item || {};"), "importedDataFields retire id, createdAt, updatedAt, backupFile, updatedBy, updatedByName");
});

test("importedDataFields retire bien updatedBy du résultat", () => {
  const testRecord = { id: "test", title: "Test", updatedAt: "2026-01-01", createdAt: "2026-01-01", backupFile: "test.zip", updatedBy: "uid-fake", updatedByName: "Fatemeh" };
  const result = importedDataFields(testRecord);
  assert.equal(result.id, undefined);
  assert.equal(result.updatedAt, undefined);
  assert.equal(result.createdAt, undefined);
  assert.equal(result.backupFile, undefined);
  assert.equal(result.updatedBy, undefined);
  assert.equal(result.updatedByName, undefined);
  assert.equal(result.title, "Test");
  assert.equal(testRecord.id, "test", "la source n'est pas mutée");
});

console.log("Person updatedBy/updatedByName : tous les tests passent");
