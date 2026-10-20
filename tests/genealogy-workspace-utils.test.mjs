import assert from "node:assert/strict";
import test from "node:test";
import { describeFirestoreReadError, legacyDocumentCardDetails } from "../js/genealogy-workspace-utils.js";

test("erreurs Firestore sont distinguées sans confondre une liste vide avec une erreur", () => {
  assert.deepEqual(describeFirestoreReadError({ code: "permission-denied" }), {
    code: "permission-denied", description: "lecture refusée par les règles Firestore"
  });
  assert.deepEqual(describeFirestoreReadError({ code: "unavailable" }), {
    code: "unavailable", description: "service Firestore indisponible ou erreur réseau"
  });
  assert.deepEqual(describeFirestoreReadError({ code: "failed-precondition" }), {
    code: "failed-precondition", description: "requête refusée ou index Firestore requis"
  });
  assert.deepEqual(describeFirestoreReadError({ code: "invalid-argument" }), {
    code: "invalid-argument", description: "requête Firestore invalide"
  });
  assert.deepEqual(describeFirestoreReadError({}), { code: "unknown", description: "erreur Firestore" });
  // Firestore retourne un QuerySnapshot vide, pas une erreur : l'appel du callback
  // de succès avec docs=[] demeure le seul chemin de chargement réussi.
  const emptySnapshot = { docs: [] };
  assert.deepEqual(emptySnapshot.docs.map(item => item), []);
});

test("carte historique : titre puis type, champs facultatifs et aucune métadonnée technique", () => {
  const item = {
    id: "document-technique-1",
    compressed: true,
    chunkCount: 3,
    chunkVersion: "v2",
    title: "Acte de naissance",
    type: "Naissance",
    date: "1891-04-03",
    place: "Orino, Varese",
    personIds: ["person-1", "person-1"],
    notes: "Copie délivrée par la mairie.",
    storageMode: "firestore-chunks",
    fileName: "acte.webp",
    mimeType: "image/webp",
    storedSize: 1024
  };
  const details = legacyDocumentCardDetails(item, ["Carlo Alberti", "Carlo Alberti"]);
  assert.deepEqual(details, {
    title: "Acte de naissance",
    date: "1891-04-03",
    place: "Orino, Varese",
    people: ["Carlo Alberti"],
    notes: "Copie délivrée par la mairie.",
    hasPhotograph: true
  });
  assert.doesNotMatch(JSON.stringify(details), /document-technique-1|compressed|chunkCount|chunkVersion|storageMode|fileName|mimeType|storedSize/);
});

test("carte historique sans titre ni détails : type comme remplacement et champs vides omis", () => {
  assert.deepEqual(legacyDocumentCardDetails({ type: "Acte de mariage", date: "", place: "", notes: "", fileName: "registre.pdf" }), {
    title: "Acte de mariage", date: "", place: "", people: [], notes: "", hasPhotograph: false
  });
  assert.deepEqual(legacyDocumentCardDetails({ fileName: "acte.webp" }), {
    title: "Document historique", date: "", place: "", people: [], notes: "", hasPhotograph: true
  });
});
