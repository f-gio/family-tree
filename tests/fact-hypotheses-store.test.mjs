import assert from "node:assert/strict";
import test from "node:test";
import { createFactHypothesesStore } from "../js/fact-hypotheses-store.js";

/* ---------- faux SDK Firestore : état mémoire, transactions différées,
   journal d'ordre des opérations pour prouver « lectures avant écritures ». */

let autoId = 0;

function clone(value) {
  return structuredClone(value);
}

function createFakeFirestore() {
  const db = { store: new Map(), opsLog: [] };
  const column = name => {
    if (!db.store.has(name)) db.store.set(name, new Map());
    return db.store.get(name);
  };
  const refPath = ref => ref.path.join("/");

  const sdk = {
    doc(refOrDb, ...segments) {
      if (refOrDb && refOrDb.__type === "collection") {
        return { __type: "doc", path: [...refOrDb.path, `auto-${++autoId}`] };
      }
      return { __type: "doc", path: [...segments] };
    },
    collection(refOrDb, name) {
      return { __type: "collection", path: [name] };
    },
    query(colRef, ...constraints) {
      return { __type: "query", path: colRef.path, constraints };
    },
    where(field, op, value) {
      return { field, op, value };
    },
    async getDocs(query) {
      let entries = [...column(query.path[0]).entries()];
      for (const constraint of query.constraints) {
        entries = entries.filter(([, data]) => data[constraint.field] === constraint.value);
      }
      return { docs: entries.map(([id, data]) => ({ id, data: () => clone(data) })) };
    },
    serverTimestamp() {
      return { __serverTimestamp: true };
    },
    deleteField() {
      return { __deleteField: true };
    },
    async runTransaction(dbRef, fn) {
      const pending = [];
      const transaction = {
        async get(ref) {
          db.opsLog.push(`get:${refPath(ref)}`);
          const data = column(ref.path[0]).get(ref.path[1]);
          return data
            ? { exists: () => true, data: () => clone(data) }
            : { exists: () => false };
        },
        set(ref, data) {
          db.opsLog.push(`set:${refPath(ref)}`);
          pending.push({ kind: "set", ref, data: clone(data) });
        },
        update(ref, data) {
          db.opsLog.push(`update:${refPath(ref)}`);
          pending.push({ kind: "update", ref, data: clone(data) });
        }
      };
      const result = await fn(transaction);
      for (const op of pending) applyWrite(db, op);
      return result;
    }
  };
  return { db, sdk };
}

function applyWrite(db, op) {
  if (!db.store.has(op.ref.path[0])) db.store.set(op.ref.path[0], new Map());
  const column = db.store.get(op.ref.path[0]);
  const id = op.ref.path[1];
  if (op.kind === "set") {
    column.set(id, clone(op.data));
    return;
  }
  const existing = column.get(id);
  if (!existing) throw new Error(`NOT_FOUND : ${op.ref.path.join("/")}`);
  for (const [key, value] of Object.entries(op.data)) {
    if (value && value.__deleteField) delete existing[key];
    else existing[key] = clone(value);
  }
}

function seed(db, collection, id, data) {
  if (!db.store.has(collection)) db.store.set(collection, new Map());
  db.store.get(collection).set(id, { ...clone(data), id });
  return db.store.get(collection).get(id);
}

function read(db, collection, id) {
  return db.store.get(collection)?.get(id) || null;
}

function personFixture(id, overrides = {}) {
  return {
    lastName: "Rossi",
    birthDate: "1869-09-13",
    birthDateInfo: { type: "exact", value: "1869-09-13" },
    place: "Rome",
    birthPlaceInfo: { name: "Rome" },
    ...overrides
  };
}

function hypothesisFixture(personId, fieldKey, overrides = {}) {
  return {
    personId,
    fieldKey,
    value: { type: "year", year: 1869 },
    status: "alternative",
    initialFromFiche: false,
    justification: "",
    attestations: [],
    documentIds: [],
    sourceIds: [],
    proofIds: [],
    authorUid: "author-uid",
    createdAt: { __serverTimestamp: true },
    updatedAt: { __serverTimestamp: true },
    updatedBy: "author-uid",
    currentRevisionId: `${overrides.id || "h"}-r1`,
    ...overrides
  };
}

function setup() {
  const { db, sdk } = createFakeFirestore();
  const store = createFactHypothesesStore("db", sdk);
  const mark = () => db.opsLog.length;
  const opsSince = index => db.opsLog.slice(index);
  return { db, store, mark, opsSince };
}

test("la première alternative promeut la valeur de la fiche en hypothèse retenue", async () => {
  const { db, store, mark, opsSince } = setup();
  seed(db, "people", "p1", personFixture("p1"));
  const start = mark();

  const result = await store.createHypothesis({
    personId: "p1", fieldKey: "birth.date",
    value: { type: "year", year: 1872 },
    justification: "Acte d’un autre dépouillement", actorUid: "u1"
  });

  assert.equal(result.created.length, 2);
  const initial = result.created.find(item => item.id === "fh_init_p1_birth.date");
  const alternative = result.created.find(item => item.id !== "fh_init_p1_birth.date");
  assert.equal(initial.status, "retained");
  assert.equal(initial.initialFromFiche, true);
  assert.deepEqual(initial.value, { type: "exact", value: "1869-09-13" });
  assert.equal(alternative.status, "alternative");
  assert.deepEqual(alternative.value, { type: "year", year: 1872 });

  const person = read(db, "people", "p1");
  assert.equal(person.retainedHypothesis["birth.date"], "fh_init_p1_birth.date");
  assert.deepEqual(person.birthDateInfo, { type: "exact", value: "1869-09-13" });

  assert.equal(read(db, "factHypotheses", "fh_init_p1_birth.date").status, "retained");
  const revisionDocs = [...db.store.get("factHypothesisRevisions").values()];
  assert.equal(revisionDocs.length, 2);
  assert.equal(revisionDocs.every(item => item.operation === "created"), true);
  assert.equal(revisionDocs.every(item => item.authorUid === "u1"), true);

  const ops = opsSince(start);
  const firstWrite = ops.findIndex(op => op.startsWith("set:") || op.startsWith("update:"));
  const lastRead = ops.map((op, index) => (op.startsWith("get:") ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
  assert.equal(firstWrite > lastRead && lastRead >= 0, true, `lecture après écriture : ${ops.join(" → ")}`);
});

test("une fiche sans valeur ne crée ni hypothèse initiale ni ancre", async () => {
  const { db, store } = setup();
  seed(db, "people", "p2", personFixture("p2", { birthDate: "", birthDateInfo: { type: "unknown" } }));

  const result = await store.createHypothesis({
    personId: "p2", fieldKey: "birth.date", value: { type: "year", year: 1870 }, actorUid: "u1"
  });

  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].status, "alternative");
  assert.equal(read(db, "people", "p2").retainedHypothesis, undefined);
});

test("la promotion d'une valeur legacy écrit le champ structuré sans toucher à la chaîne legacy", async () => {
  const { db, store } = setup();
  seed(db, "people", "pLegacy", {
    lastName: "Bianchi",
    birthDate: "1871-06-02",
    deathDate: "1943-01-15"
  });

  const result = await store.createHypothesis({
    personId: "pLegacy", fieldKey: "birth.date", value: { type: "year", year: 1875 }, actorUid: "u1"
  });

  assert.equal(result.created.length, 2);
  const initial = result.created.find(item => item.id === "fh_init_pLegacy_birth.date");
  assert.deepEqual(initial.value, { type: "exact", value: "1871-06-02" });
  const person = read(db, "people", "pLegacy");
  assert.deepEqual(person.birthDateInfo, { type: "exact", value: "1871-06-02" });
  assert.equal(person.birthDate, "1871-06-02", "la valeur legacy exacte est conservée");
  assert.equal(person.retainedHypothesis["birth.date"], "fh_init_pLegacy_birth.date");
});

test("une ancre existante empêche toute nouvelle promotion", async () => {
  const { db, store } = setup();
  seed(db, "people", "p1", personFixture("p1", { retainedHypothesis: { "birth.date": "h1" } }));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p1", "birth.date", { status: "retained" }));

  const result = await store.createHypothesis({
    personId: "p1", fieldKey: "birth.date", value: { type: "year", year: 1875 }, actorUid: "u1"
  });

  assert.equal(result.created.length, 1);
  assert.equal(result.created[0].status, "alternative");
  assert.equal(read(db, "people", "p1").retainedHypothesis["birth.date"], "h1");
  assert.equal(read(db, "people", "p1").retainedHypothesis["birth.date"], "h1");
});

test("la première retenue n'exige pas de justification et met à jour la fiche et l'ancre", async () => {
  const { db, store } = setup();
  seed(db, "people", "p3", personFixture("p3"));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p3", "birth.date", {
    id: "h1", value: { type: "year", year: 1870 }
  }));

  const result = await store.setRetained({
    personId: "p3", fieldKey: "birth.date", hypothesisId: "h1", actorUid: "u1", expectedAnchor: null
  });

  assert.equal(result.updated.length, 1);
  const person = read(db, "people", "p3");
  assert.equal(person.retainedHypothesis["birth.date"], "h1");
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1870 });
  assert.equal("birthDate" in person, false, "le miroir legacy exact doit être retiré pour une valeur année");
  assert.equal(read(db, "factHypotheses", "h1").status, "retained");
  const revisions = [...db.store.get("factHypothesisRevisions").values()];
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].operation, "retained");
});

test("le remplacement d'une retenue exige une justification et une ancre à jour", async () => {
  const { db, store } = setup();
  seed(db, "people", "p4", personFixture("p4", { retainedHypothesis: { "birth.date": "h1" } }));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p4", "birth.date", { id: "h1", status: "retained" }));
  seed(db, "factHypotheses", "h2", hypothesisFixture("p4", "birth.date", { id: "h2", value: { type: "year", year: 1872 } }));
  const before = clone(read(db, "people", "p4"));

  await assert.rejects(
    store.setRetained({ personId: "p4", fieldKey: "birth.date", hypothesisId: "h2", actorUid: "u1", expectedAnchor: "h1" }),
    /justification est obligatoire/
  );
  assert.deepEqual(read(db, "people", "p4"), before, "aucune écriture ne doit avoir été appliquée");

  await assert.rejects(
    store.setRetained({
      personId: "p4", fieldKey: "birth.date", hypothesisId: "h2",
      justification: "Acte retrouvé", actorUid: "u1", expectedAnchor: "stale"
    }),
    /ancre d’unicité a changé/
  );
  assert.deepEqual(read(db, "people", "p4"), before, "aucune écriture ne doit avoir été appliquée");
  assert.equal(read(db, "factHypotheses", "h1").status, "retained");

  const result = await store.setRetained({
    personId: "p4", fieldKey: "birth.date", hypothesisId: "h2",
    justification: "Acte retrouvé aux archives", actorUid: "u1", expectedAnchor: "h1"
  });

  assert.equal(result.updated.length, 2);
  assert.equal(read(db, "factHypotheses", "h1").status, "alternative");
  assert.equal(read(db, "factHypotheses", "h2").status, "retained");
  const person = read(db, "people", "p4");
  assert.equal(person.retainedHypothesis["birth.date"], "h2");
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1872 });
  assert.equal(person.updatedBy, "u1");
  const operations = [...db.store.get("factHypothesisRevisions").values()].map(item => item.operation);
  assert.deepEqual(operations.sort(), ["retained", "retained"]);
});

test("une hypothèse retenue ne peut pas être supprimée et une supprimée se restaure en alternative", async () => {
  const { db, store } = setup();
  seed(db, "people", "p5", personFixture("p5", { retainedHypothesis: { "birth.place": "h1" } }));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p5", "birth.place", {
    id: "h1", fieldKey: "birth.place", status: "retained", value: { place: "Rome", placeInfo: { name: "Rome" } }
  }));
  seed(db, "factHypotheses", "h2", hypothesisFixture("p5", "birth.place", { id: "h2", fieldKey: "birth.place" }));

  await assert.rejects(
    store.deleteHypothesis({ personId: "p5", fieldKey: "birth.place", hypothesisId: "h1", actorUid: "u1" }),
    /remplacez-la/
  );
  assert.equal(read(db, "factHypotheses", "h1").status, "retained");

  await store.deleteHypothesis({
    personId: "p5", fieldKey: "birth.place", hypothesisId: "h2", actorUid: "u1", expectedAnchor: "h1"
  });
  assert.equal(read(db, "factHypotheses", "h2").status, "deleted");

  const restored = await store.restoreHypothesis({
    personId: "p5", fieldKey: "birth.place", hypothesisId: "h2", actorUid: "u1"
  });
  assert.equal(restored.updated[0].status, "alternative");
  assert.equal(read(db, "factHypotheses", "h2").status, "alternative");
  assert.notEqual(read(db, "factHypotheses", "h2").status, "retained");

  await store.rejectHypothesis({ personId: "p5", fieldKey: "birth.place", hypothesisId: "h2", actorUid: "u1" });
  assert.equal(read(db, "factHypotheses", "h2").status, "rejected");
  assert.equal(read(db, "factHypotheses", "h1").status, "retained");
});

test("la correction de valeur réécrit la fiche uniquement pour la retenue", async () => {
  const { db, store } = setup();
  seed(db, "people", "p6", personFixture("p6", { retainedHypothesis: { "birth.date": "h1" } }));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p6", "birth.date", {
    id: "h1", status: "retained", value: { type: "year", year: 1869 },
    attestations: [{ attestationId: "att-1", role: "supports" }]
  }));
  seed(db, "factHypotheses", "h2", hypothesisFixture("p6", "birth.date", { id: "h2", value: { type: "year", year: 1872 } }));

  await store.correctValue({
    personId: "p6", fieldKey: "birth.date", hypothesisId: "h2",
    value: { type: "about", year: 1873 }, actorUid: "u1"
  });
  assert.deepEqual(read(db, "people", "p6").birthDateInfo, { type: "exact", value: "1869-09-13" });
  assert.deepEqual(read(db, "factHypotheses", "h2").value, { type: "about", year: 1873 });

  await store.correctValue({
    personId: "p6", fieldKey: "birth.date", hypothesisId: "h1",
    value: { type: "year", year: 1868 }, justification: "Recoupement", actorUid: "u1"
  });
  const person = read(db, "people", "p6");
  assert.deepEqual(person.birthDateInfo, { type: "year", year: 1868 });
  assert.equal("birthDate" in person, false);
  assert.equal(person.retainedHypothesis["birth.date"], "h1");
  assert.deepEqual(read(db, "factHypotheses", "h1").attestations, [{ attestationId: "att-1", role: "supports" }]);
});

test("les attestations s'associent par rôle et se détachent", async () => {
  const { db, store } = setup();
  seed(db, "factHypotheses", "h1", hypothesisFixture("p7", "death.date", { id: "h1" }));

  await store.attachAttestation({
    personId: "p7", fieldKey: "death.date", hypothesisId: "h1",
    attestationId: "att-1", role: "supports", actorUid: "u1"
  });
  await store.attachAttestation({
    personId: "p7", fieldKey: "death.date", hypothesisId: "h1",
    attestationId: "att-2", role: "contradicts", actorUid: "u1"
  });
  assert.deepEqual(read(db, "factHypotheses", "h1").attestations, [
    { attestationId: "att-1", role: "supports" },
    { attestationId: "att-2", role: "contradicts" }
  ]);

  await assert.rejects(
    store.attachAttestation({
      personId: "p7", fieldKey: "death.date", hypothesisId: "h1",
      attestationId: "att-3", role: "decisive", actorUid: "u1"
    }),
    /Rôle d’attestation inconnu/
  );

  await store.attachAttestation({
    personId: "p7", fieldKey: "death.date", hypothesisId: "h1",
    attestationId: "att-1", role: "supports", remove: true, actorUid: "u1"
  });
  assert.deepEqual(read(db, "factHypotheses", "h1").attestations, [
    { attestationId: "att-2", role: "contradicts" }
  ]);
});

test("les associations d'attestations résistent aux changements de statut et sont historisées", async () => {
  const { db, store } = setup();
  seed(db, "people", "p-att", personFixture("p-att"));
  seed(db, "factHypotheses", "h-att", hypothesisFixture("p-att", "birth.date", {
    id: "h-att", attestations: [],
    documentIds: ["doc-1"], sourceIds: ["src-1"], proofIds: ["prf-1"]
  }));

  const added = await store.attachAttestation({
    personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att",
    attestationId: "att-1", role: "supports", actorUid: "u1"
  });
  assert.deepEqual(added.updated[0].attestations, [{ attestationId: "att-1", role: "supports" }]);

  /* Re-associer le même identifiant remplace le rôle : jamais de doublon. */
  const replaced = await store.attachAttestation({
    personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att",
    attestationId: "att-1", role: "contradicts", actorUid: "u1"
  });
  assert.deepEqual(replaced.updated[0].attestations, [{ attestationId: "att-1", role: "contradicts" }]);

  await store.attachAttestation({
    personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att",
    attestationId: "att-2", role: "context", actorUid: "u1"
  });
  const expected = [
    { attestationId: "att-1", role: "contradicts" },
    { attestationId: "att-2", role: "context" }
  ];
  assert.deepEqual(read(db, "factHypotheses", "h-att").attestations, expected);

  const revisionOps = () => [...db.store.get("factHypothesisRevisions").values()]
    .filter(item => item.objectId === "h-att").map(item => item.operation);
  assert.deepEqual(revisionOps(), ["attestation-updated", "attestation-updated", "attestation-updated"]);

  /* Changement de statut puis suppression logique : les associations restent. */
  await store.rejectHypothesis({ personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att", actorUid: "u1" });
  assert.deepEqual(read(db, "factHypotheses", "h-att").attestations, expected);
  await store.deleteHypothesis({ personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att", actorUid: "u1" });
  assert.deepEqual(read(db, "factHypotheses", "h-att").attestations, expected);

  /* Aucune modification possible sur une hypothèse supprimée (validation client). */
  await assert.rejects(
    store.attachAttestation({
      personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att",
      attestationId: "att-3", role: "supports", actorUid: "u1"
    }),
    /supprimée ne peut pas être modifiée/
  );

  const restored = await store.restoreHypothesis({ personId: "p-att", fieldKey: "birth.date", hypothesisId: "h-att", actorUid: "u1" });
  assert.equal(restored.updated[0].status, "alternative");
  assert.deepEqual(restored.updated[0].attestations, expected);

  /* Les références documentaires ne sont jamais altérées par les transitions. */
  const finalHypothesis = read(db, "factHypotheses", "h-att");
  assert.deepEqual(finalHypothesis.documentIds, ["doc-1"]);
  assert.deepEqual(finalHypothesis.sourceIds, ["src-1"]);
  assert.deepEqual(finalHypothesis.proofIds, ["prf-1"]);
});

test("le réexamen ramène une hypothèse écartée en alternative sans toucher à la fiche", async () => {
  const { db, store } = setup();
  seed(db, "people", "p-rex", personFixture("p-rex", {
    retainedHypothesis: { "birth.date": "h-ret" },
    birthDateInfo: { type: "year", year: 1870 }
  }));
  seed(db, "factHypotheses", "h-ret", hypothesisFixture("p-rex", "birth.date", {
    id: "h-ret", status: "retained", value: { type: "year", year: 1870 },
    currentRevisionId: "h-ret-r1"
  }));
  seed(db, "factHypotheses", "h-rex", hypothesisFixture("p-rex", "birth.date", {
    id: "h-rex", status: "rejected", value: { type: "year", year: 1865 },
    currentRevisionId: "h-rex-r1",
    attestations: [{ attestationId: "att-9", role: "contradicts" }],
    documentIds: ["doc-9"], sourceIds: ["src-9"], proofIds: ["prf-9"]
  }));
  const personBefore = JSON.parse(JSON.stringify(read(db, "people", "p-rex")));

  /* Justification obligatoire. */
  await assert.rejects(
    store.reexamineHypothesis({ personId: "p-rex", fieldKey: "birth.date", hypothesisId: "h-rex", justification: "   ", actorUid: "u1" }),
    /justification est obligatoire pour réexaminer/
  );

  /* La restauration reste réservée aux hypothèses supprimées. */
  await assert.rejects(
    store.restoreHypothesis({ personId: "p-rex", fieldKey: "birth.date", hypothesisId: "h-rex", actorUid: "u1" }),
    /Seule une hypothèse supprimée/
  );

  const result = await store.reexamineHypothesis({
    personId: "p-rex", fieldKey: "birth.date", hypothesisId: "h-rex",
    justification: "Acte retrouvé aux archives", actorUid: "u1"
  });

  /* Le réexamen ne produit jamais d'alternative sur une autre hypothèse : il
     conserve la valeur, les attestations et les références documentaires. */
  assert.equal(result.updated[0].status, "alternative");
  assert.deepEqual(result.updated[0].value, { type: "year", year: 1865 });
  assert.deepEqual(result.updated[0].attestations, [{ attestationId: "att-9", role: "contradicts" }]);
  assert.deepEqual(result.updated[0].documentIds, ["doc-9"]);
  assert.deepEqual(result.updated[0].sourceIds, ["src-9"]);
  assert.deepEqual(result.updated[0].proofIds, ["prf-9"]);

  /* Fiche, ancre et retenue intactes ; aucune hypothèse créée. */
  assert.deepEqual(read(db, "people", "p-rex"), personBefore);
  assert.equal(read(db, "factHypotheses", "h-ret").status, "retained");
  assert.equal([...db.store.get("factHypotheses").keys()].filter(id => id.startsWith("fh_")).length, 0, "aucune hypothèse créée");

  /* Révision immuable retraçant l'opération, chaînée sur la tête précédente. */
  const revision = [...db.store.get("factHypothesisRevisions").values()]
    .find(item => item.objectId === "h-rex" && item.operation === "reexamined");
  assert.ok(revision, "révision reexamined créée");
  assert.equal(revision.previousRevisionId, "h-rex-r1");
  assert.equal(revision.justification, "Acte retrouvé aux archives");
  assert.equal(revision.authorUid, "u1");

  /* L'opération est réservée à une hypothèse encore écartée. */
  await assert.rejects(
    store.reexamineHypothesis({ personId: "p-rex", fieldKey: "birth.date", hypothesisId: "h-rex", justification: "Encore", actorUid: "u1" }),
    /Seule une hypothèse écartée/
  );
  assert.equal(read(db, "factHypotheses", "h-rex").status, "alternative");
});

test("la liste par personne ne retourne que ses hypothèses", async () => {
  const { db, store } = setup();
  seed(db, "factHypotheses", "h1", hypothesisFixture("p1", "birth.date", { id: "h1" }));
  seed(db, "factHypotheses", "h2", hypothesisFixture("p2", "birth.date", { id: "h2" }));

  const list = await store.listForPerson("p1");
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "h1");
  assert.equal(list[0].personId, "p1");
});

test("toutes les lectures précèdent les écritures dans chaque opération", async () => {
  const { db, store, mark, opsSince } = setup();
  seed(db, "people", "p8", personFixture("p8"));
  seed(db, "factHypotheses", "h1", hypothesisFixture("p8", "birth.date", { id: "h1" }));

  const operations = [
    () => store.createHypothesis({ personId: "p8", fieldKey: "birth.date", value: { type: "year", year: 1870 }, actorUid: "u1" }),
    () => store.setRetained({ personId: "p8", fieldKey: "birth.date", hypothesisId: "h1", justification: "Remplacement contrôlé", actorUid: "u1" }),
    () => store.correctValue({ personId: "p8", fieldKey: "birth.date", hypothesisId: "h1", value: { type: "year", year: 1871 }, actorUid: "u1" }),
    () => store.deleteHypothesis({ personId: "p8", fieldKey: "birth.date", hypothesisId: "fh_init_p8_birth.date", actorUid: "u1" })
  ];
  for (const operation of operations) {
    const start = mark();
    await operation();
    const ops = opsSince(start);
    const firstWrite = ops.findIndex(op => op.startsWith("set:") || op.startsWith("update:"));
    const lastRead = ops.map((op, index) => (op.startsWith("get:") ? index : -1)).reduce((a, b) => Math.max(a, b), -1);
    assert.equal(firstWrite > lastRead && lastRead >= 0, true, `lecture après écriture : ${ops.join(" → ")}`);
  }
});
