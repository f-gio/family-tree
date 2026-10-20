const FIRESTORE_READ_ERROR_TYPES = new Map([
  ["permission-denied", "lecture refusée par les règles Firestore"],
  ["unavailable", "service Firestore indisponible ou erreur réseau"],
  ["deadline-exceeded", "délai réseau dépassé"],
  ["network-request-failed", "connexion réseau indisponible"],
  ["failed-precondition", "requête refusée ou index Firestore requis"],
  ["invalid-argument", "requête Firestore invalide"]
]);

export function describeFirestoreReadError(error) {
  const code = String(error?.code || "").replace(/^firestore\//, "");
  const description = FIRESTORE_READ_ERROR_TYPES.get(code) || "erreur Firestore";
  return { code: code || "unknown", description };
}

export function legacyDocumentCardDetails(item = {}, personNames = []) {
  const title = String(item.title || "").trim() || String(item.type || "").trim() || "Document historique";
  const date = typeof item.date === "string" ? item.date.trim() : "";
  const place = typeof item.place === "string" ? item.place.trim() : "";
  const people = [...new Set(personNames.map(name => String(name || "").trim()).filter(Boolean))];
  const notes = typeof item.notes === "string" ? item.notes.trim() : "";
  const fileName = typeof item.fileName === "string" ? item.fileName.trim() : "";
  const mimeType = typeof item.mimeType === "string" ? item.mimeType.toLowerCase() : "";
  const hasPhotograph = mimeType.startsWith("image/") || /\.(?:jpe?g|png|webp|gif|tiff?)$/i.test(fileName);
  return { title, date, place, people, notes, hasPhotograph };
}
