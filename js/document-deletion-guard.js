const DOCUMENT_REFERENCE_KEYS = new Set(["documentId", "documentIds", "targetId", "targetIds", "targetDocumentId", "targetDocumentIds"]);

function referencesDocument(value, documentId, seen = new Set()) {
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some(item => referencesDocument(item, documentId, seen));
  for (const [key, nested] of Object.entries(value)) {
    if (DOCUMENT_REFERENCE_KEYS.has(key)) {
      if (nested === documentId || (Array.isArray(nested) && nested.includes(documentId))) return true;
    }
    if (key === "resourceRef" && nested === `legacy-document:${documentId}`) return true;
    if (referencesDocument(nested, documentId, seen)) return true;
  }
  return false;
}

/**
 * Vérifie sans écriture les associations visibles avant toute suppression.
 * L'appelant doit fournir un instantané complet ; une erreur/collection en
 * chargement bloque la suppression plutôt que de supposer qu'aucune référence
 * n'existe.
 */
export function documentDeletionBlockers({ documentItem, people = [], records = {}, otherRecords = [], snapshotComplete = false } = {}) {
  if (!documentItem?.id) return ["Ce document n’est plus disponible."];
  if (!snapshotComplete) return ["Les associations ne peuvent pas toutes être vérifiées. Réessayez lorsque la synchronisation sera rétablie."];

  const blockers = [];
  const personReferences = (Array.isArray(documentItem.personIds) && documentItem.personIds.length > 0)
    || people.some(person => referencesDocument(person, documentItem.id));
  if (personReferences) blockers.push("des personnes ou leurs attestations");

  const referenceGroups = [
    { label: "des Sources", records: [...(records.sourceDocuments || []), ...(records.sourceRevisions || [])] },
    { label: "des Preuves", records: [...(records.genealogyProofs || []), ...(records.genealogyProofRevisions || [])] },
    { label: "des transcriptions", records: [...(records.transcriptionHeads || []), ...(records.transcriptionRevisions || [])] },
    { label: "d’autres données ou historiques", records: [
      ...(records.factConclusions || []), ...(records.conclusionRevisions || []),
      ...(records.genealogyProposals || []), ...(records.genealogyEvents || []),
      ...(records.genealogyNotifications || []), ...otherRecords
    ] }
  ];
  for (const group of referenceGroups) {
    if (group.records.some(record => referencesDocument(record, documentItem.id))) blockers.push(group.label);
  }
  return blockers;
}
