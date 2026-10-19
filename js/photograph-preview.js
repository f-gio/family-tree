/* Générateur optionnel d'aperçus dans un navigateur.
   Aucun accès à document/window lors de l'import ; aucune dépendance à une
   bibliothèque d'image. Le Blob d'entrée n'est jamais modifié ni retourné
   comme original : le résultat est un dérivé distinct.
*/

export async function generatePhotographPreview(blob, {
  createImageBitmapImpl = globalThis.createImageBitmap,
  documentRef = globalThis.document,
  maxDimension = 1600,
  mimeType = "image/webp",
  quality = 0.82
} = {}) {
  if (!blob || typeof blob.arrayBuffer !== "function" || !Number.isFinite(blob.size) || blob.size <= 0) {
    throw new TypeError("Fournir un fichier image non vide");
  }
  if (typeof createImageBitmapImpl !== "function" || !documentRef?.createElement) {
    throw new Error("La génération d’aperçu nécessite un navigateur avec canvas et createImageBitmap");
  }
  if (!Number.isInteger(maxDimension) || maxDimension < 1) throw new TypeError("maxDimension doit être un entier positif");
  if (typeof mimeType !== "string" || !mimeType.trim()) throw new TypeError("mimeType doit être une chaîne non vide");
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) throw new TypeError("quality doit être supérieur à 0 et inférieur ou égal à 1");

  const bitmap = await createImageBitmapImpl(blob);
  try {
    if (!Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width < 1 || bitmap.height < 1) {
      throw new Error("Dimensions de l’image source invalides");
    }
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = documentRef.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Contexte canvas indisponible pour l’aperçu");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    const previewBlob = await new Promise((resolve, reject) => {
      canvas.toBlob(result => result ? resolve(result) : reject(new Error("Le navigateur n’a pas pu encoder l’aperçu")), mimeType, quality);
    });
    return { blob: previewBlob, mimeType: previewBlob.type || mimeType, width, height };
  } finally {
    bitmap.close?.();
  }
}
