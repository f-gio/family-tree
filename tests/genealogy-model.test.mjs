import assert from "node:assert/strict";
import fs from "node:fs";
import { formatGenealogyDate, genealogyDateMatchesYear, genealogyDateSortValue, normalizeGenealogyDate } from "../js/genealogy-date.js";
import { childLineType, normalizedParentChildLinks, parentChildLinkType } from "../js/family-relations.js";
import { filterAndSortDirectory } from "../js/directory-utils.js";

assert.equal(formatGenealogyDate({ type: "exact", value: "1869-03-14" }), "14 mars 1869");
assert.equal(formatGenealogyDate({ type: "exact", value: "0099-03-14" }), "14 mars 99");
assert.equal(formatGenealogyDate({ type: "exact", value: "0000-03-14" }), "—");
assert.equal(formatGenealogyDate({ type: "year", year: 1869 }), "1869");
assert.equal(formatGenealogyDate({ type: "about", year: 1869 }), "vers 1869");
assert.equal(formatGenealogyDate({ type: "between", from: 1867, to: 1871 }), "entre 1867 et 1871");
assert.equal(formatGenealogyDate({ type: "unknown" }), "—");
assert.equal(formatGenealogyDate(null, "1932-06-08"), "8 juin 1932");
assert.deepEqual(normalizeGenealogyDate(null, "1869-03-14"), { type: "exact", value: "1869-03-14" });
assert.equal(genealogyDateMatchesYear({ type: "between", from: 1867, to: 1871 }, "", 1869), true);
assert.equal(genealogyDateMatchesYear({ type: "between", from: 1867, to: 1871 }, "", 1872), false);
assert.equal(genealogyDateSortValue({ type: "about", year: 1869 }), 18690500);
assert.equal(formatGenealogyDate({ type: "year", year: 1869 }).includes("01/01"), false);

const oldFamily = { partnerIds: ["p1", "p2"], childIds: ["c1"] };
assert.equal(normalizedParentChildLinks(oldFamily).length, 2);
assert.equal(parentChildLinkType(oldFamily, "p1", "c1"), "unknown");
const typedFamily = { ...oldFamily, parentChildLinks: [{ parentId: "p1", childId: "c1", type: "biological" }, { parentId: "p2", childId: "c1", type: "adoptive" }] };
assert.equal(parentChildLinkType(typedFamily, "p2", "c1"), "adoptive");
assert.equal(childLineType(typedFamily, "c1"), "standard");
assert.equal(childLineType({ ...oldFamily, parentChildLinks: [{ parentId: "p1", childId: "c1", type: "uncertain" }] }, "c1"), "uncertain");
assert.equal(childLineType({ partnerIds: ["p1"], childIds: ["c1"], parentChildLinks: [{ parentId: "p1", childId: "c1", type: "adoptive" }] }, "c1"), "adoptive");

const people = [
  { id: "a", lastName: "Ancien", birthDateInfo: { type: "between", from: 1800, to: 1810 } },
  { id: "b", lastName: "Milieu", birthDateInfo: { type: "about", year: 1850 } },
  { id: "c", lastName: "Récent", birthDate: "1900-02-03" },
  { id: "d", lastName: "Inconnu" }
];
assert.deepEqual(filterAndSortDirectory(people, { sort: "birth-asc" }).map(item => item.id), ["a", "b", "c", "d"]);
assert.deepEqual(filterAndSortDirectory(people, { birthYear: "1805" }).map(item => item.id), ["a"]);

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(ids).size, ids.length, "Les identifiants HTML doivent être uniques");
for (const id of ["birthYear", "deathYear", "familyDetailsDialog", "familyRelationType", "familyEndType", "filiationEditors"]) assert.ok(ids.includes(id), `Identifiant manquant : ${id}`);

process.stdout.write("Tests du modèle généalogique : OK\n");
