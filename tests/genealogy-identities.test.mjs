import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFactIdentityId,
  buildLegacyParentChildIdentityId,
  createParentChildRelationRecord,
  invalidateParentChildRelation
} from "../js/genealogy-identities.js";

// Contrat des helpers purs uniquement : ces tests ne simulent pas les mutations
// Firestore de familles et ne prétendent pas vérifier leur persistance.

test("un fait vide puis renseigné garde le même identifiant indépendant de sa valeur", () => {
  const personne = { id: "personne-1", birthDate: "" };
  const vide = buildFactIdentityId("person", personne.id, "birth.date");
  personne.birthDate = "1898-04-12";
  const renseigne = buildFactIdentityId("person", personne.id, "birth.date");
  personne.birthDateInfo = { type: "year", year: 1898 };
  const corrige = buildFactIdentityId("person", personne.id, "birth.date");

  assert.equal(vide, renseigne);
  assert.equal(renseigne, corrige);
});

test("les champs de fait d'une même personne ont des identités distinctes", () => {
  assert.notEqual(
    buildFactIdentityId("person", "personne-1", "name.given"),
    buildFactIdentityId("person", "personne-1", "name.birthSurname")
  );
  assert.notEqual(
    buildFactIdentityId("person", "personne-1", "birth.date"),
    buildFactIdentityId("person", "personne-1", "birth.place")
  );
});

test("les composants contenant séparateurs et caractères encodés ne créent pas de collision", () => {
  const first = buildFactIdentityId("person", "id~part", "birth.date");
  const second = buildFactIdentityId("person", "id", "part~birth.date");
  assert.notEqual(first, second);
  assert.doesNotMatch(first, /\//);
});

test("la clé legacy d'un lien distingue famille, parent et enfant", () => {
  const base = buildLegacyParentChildIdentityId("family-1", "parent-a", "child-a");
  assert.notEqual(base, buildLegacyParentChildIdentityId("family-1", "parent-b", "child-a"));
  assert.notEqual(base, buildLegacyParentChildIdentityId("family-1", "parent-a", "child-b"));
  assert.notEqual(base, buildLegacyParentChildIdentityId("family-2", "parent-a", "child-a"));
});

test("réordonner les tableaux legacy ne change pas la clé du même lien", () => {
  const avant = {
    id: "family-1",
    partnerIds: ["parent-a", "parent-b"],
    childIds: ["child-a", "child-b"]
  };
  const apresReorganisation = {
    ...avant,
    partnerIds: [...avant.partnerIds].reverse(),
    childIds: [...avant.childIds].reverse()
  };
  const idAvant = buildLegacyParentChildIdentityId(avant.id, "parent-a", "child-b");
  const idApres = buildLegacyParentChildIdentityId(apresReorganisation.id, "parent-a", "child-b");

  assert.notDeepEqual(avant.partnerIds, apresReorganisation.partnerIds);
  assert.notDeepEqual(avant.childIds, apresReorganisation.childIds);
  assert.equal(idAvant, idApres);
  assert.notEqual(idAvant, buildLegacyParentChildIdentityId("family-recreated", "parent-a", "child-b"));
});

test("un enregistrement explicite conserve son ID et ses participants après invalidation", () => {
  const active = createParentChildRelationRecord({
    relationshipId: "relation-stable-1",
    familyId: "family-1",
    parentId: "parent-1",
    childId: "child-1"
  });
  const invalidated = invalidateParentChildRelation(active, {
    at: "2026-10-19T12:00:00.000Z",
    reason: "Lien retiré après réexamen"
  });

  assert.equal(invalidated.id, active.id);
  assert.equal(invalidated.familyId, active.familyId);
  assert.equal(invalidated.parentId, active.parentId);
  assert.equal(invalidated.childId, active.childId);
  assert.equal(invalidated.state, "invalidated");
  assert.equal(invalidated.invalidationReason, "Lien retiré après réexamen");
  assert.equal(active.state, "active", "la fonction ne mute pas l'objet d'entrée");
});

test("le tombstone explicite reste invalidable sans relire la famille legacy", () => {
  const relation = createParentChildRelationRecord({
    relationshipId: "relation-historique",
    familyId: "family-1",
    parentId: "parent-1",
    childId: "child-1"
  });
  // On fournit uniquement le snapshot relationnel au helper : aucune famille
  // ni mutation de l'ancien modèle n'est lue ou simulée par ce test.
  const archiveRelation = invalidateParentChildRelation(relation, { reason: "Dissociation" });

  assert.equal(archiveRelation.id, "relation-historique");
  assert.equal(archiveRelation.parentId, "parent-1");
  assert.equal(archiveRelation.childId, "child-1");
  assert.equal(archiveRelation.familyId, "family-1");
  assert.equal(archiveRelation.state, "invalidated");
});

test("le transfert d'arbre ne modifie pas l'identité d'un fait personnel", () => {
  const factBefore = buildFactIdentityId("person", "personne-1", "death.place");
  const before = { id: "personne-1", treeId: "main", deathPlace: "Torino" };
  const afterTransfer = { ...before, treeId: "tree-2" };
  const factAfter = buildFactIdentityId("person", afterTransfer.id, "death.place");

  assert.equal(factBefore, factAfter);
  assert.equal(before.treeId, "main", "l'objet initial n'est pas muté");
});

test("les formats historiques restent hors du calcul d'identité", () => {
  const legacyPerson = { id: "personne-legacy", birthDate: "1870-01-02", place: "Turin" };
  const idLegacy = buildFactIdentityId("person", legacyPerson.id, "birth.date");
  const structuredPerson = { id: legacyPerson.id, birthDateInfo: { type: "year", year: 1870 }, place: "Torino" };
  const idStructured = buildFactIdentityId("person", structuredPerson.id, "birth.date");

  assert.equal(idLegacy, idStructured);
  assert.equal(legacyPerson.birthDate, "1870-01-02", "aucune conversion ou mutation n'est effectuée");
});

test("les identifiants incomplets et les relations réflexives sont refusés", () => {
  assert.throws(() => buildFactIdentityId("person", "", "birth.date"), /subjectId/);
  assert.throws(() => buildLegacyParentChildIdentityId("family-1", "parent-1", ""), /childId/);
  assert.throws(() => createParentChildRelationRecord({
    relationshipId: "relation-1",
    familyId: "family-1",
    parentId: "person-1",
    childId: "person-1"
  }), /elle-même/);
});
