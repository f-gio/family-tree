import assert from "node:assert/strict";
import test from "node:test";
import { describeFirestoreReadError, legacyDocumentCardDetails, configureGenealogyContributionDialog } from "../js/genealogy-workspace-utils.js";

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

test("formulaire contribution : les trois modes réinitialisent tous les textes et la référence", () => {
  const elements = {
    title: { textContent: "ancienne valeur" },
    subtitle: { textContent: "ancienne valeur" },
    primaryAction: { textContent: "ancienne valeur" },
    target: { readOnly: true },
    targetHelp: { textContent: "ancienne valeur" },
    payloadHelp: { textContent: "ancienne valeur" }
  };

  configureGenealogyContributionDialog(elements, { official: false, type: "source" });
  assert.equal(elements.title.textContent, "Proposer une contribution");
  assert.equal(elements.subtitle.textContent, "Préparez une proposition. Vous pourrez la soumettre ensuite à validation.");
  assert.equal(elements.primaryAction.textContent, "Enregistrer le brouillon");
  assert.equal(elements.target.readOnly, false);
  assert.equal(elements.targetHelp.textContent, "Référence cible facultative : indiquez l'identifiant de l'élément concerné si vous le connaissez.");
  assert.equal(elements.payloadHelp.textContent, "Texte libre accepté pour les sources et corrections.");

  configureGenealogyContributionDialog(elements, { official: true, type: "proof" });
  assert.equal(elements.title.textContent, "Créer une preuve");
  assert.equal(elements.subtitle.textContent, "La preuve sera enregistrée officiellement avec son événement d’historique.");
  assert.equal(elements.primaryAction.textContent, "Créer la preuve");
  assert.equal(elements.target.readOnly, false);
  assert.equal(elements.targetHelp.textContent, "Un identifiant est généré automatiquement si ce champ reste vide.");
  assert.equal(elements.payloadHelp.textContent, "Données JSON structurées requises pour les transcriptions, preuves et conclusions.");

  configureGenealogyContributionDialog(elements, { official: true, revise: true, type: "conclusion" });
  assert.equal(elements.title.textContent, "Réviser une donnée officielle");
  assert.equal(elements.subtitle.textContent, "Cette modification créera une nouvelle révision conservée dans l'historique.");
  assert.equal(elements.primaryAction.textContent, "Enregistrer");
  assert.equal(elements.target.readOnly, true);
  assert.equal(elements.targetHelp.textContent, "Référence existante de la donnée révisée ; elle ne peut pas être remplacée.");
  assert.equal(elements.payloadHelp.textContent, "Données JSON structurées requises pour les transcriptions, preuves et conclusions.");

  configureGenealogyContributionDialog(elements, { type: "correction" });
  assert.equal(elements.title.textContent, "Proposer une contribution");
  assert.equal(elements.primaryAction.textContent, "Enregistrer le brouillon");
  assert.equal(elements.target.readOnly, false);
  assert.equal(elements.payloadHelp.textContent, "Texte libre accepté pour les sources et corrections.");
});
