/** Suppression atomique d'une fiche Document et de ses chunks Firestore. */
export async function deleteDocumentAndChunks(item, {
  createBatch,
  documentReference,
  chunkReference,
  maximumWrites = 500
} = {}) {
  if (!item?.id || typeof createBatch !== "function" || typeof documentReference !== "function") {
    throw new TypeError("Les références et le lot de suppression du document sont requis");
  }
  const hasVersion = Boolean(item.chunkVersion);
  const hasCount = item.chunkCount !== undefined && item.chunkCount !== null;
  if (hasVersion !== hasCount || (hasCount && (!Number.isInteger(item.chunkCount) || item.chunkCount < 1))) {
    throw new Error("Les références des blocs du fichier sont incomplètes.");
  }
  if (hasCount && typeof chunkReference !== "function") throw new TypeError("La référence des blocs du fichier est requise");
  if ((item.chunkCount || 0) + 1 > maximumWrites) throw new Error("Le fichier contient trop de blocs pour une suppression atomique.");

  const batch = createBatch();
  if (hasCount) {
    for (let index = 0; index < item.chunkCount; index++) {
      batch.delete(chunkReference(item.id, item.chunkVersion, index));
    }
  }
  batch.delete(documentReference(item.id));
  await batch.commit();
  return true;
}
