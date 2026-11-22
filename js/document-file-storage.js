export function createDocumentFileStore({ chunkReference, setDoc, deleteDoc, getDoc, Bytes, splitBytesIntoChunks, collectChunkParts, concatByteArrays, base64ToBytes, chunkSize, warn = console.warn }) {
  async function writeFileChunks(documentId, version, fileBlob, onProgress = () => {}) {
    const bytes = new Uint8Array(await fileBlob.arrayBuffer());
    const parts = splitBytesIntoChunks(bytes, chunkSize);
    const count = parts.length;
    let written = 0;
    try {
      for (let index = 0; index < count; index++) {
        const part = parts[index];
        await setDoc(chunkReference(documentId, version, index), {
          documentId,
          version,
          index,
          data: Bytes.fromUint8Array(part),
          encoding: "bytes"
        });
        written++;
        onProgress(Math.round(written / count * 100));
      }
      return count;
    } catch (error) {
      await deleteFileChunks({ id: documentId, chunkVersion: version, chunkCount: written });
      throw error;
    }
  }

  async function deleteFileChunks(item) {
    if (!item?.id || !item?.chunkVersion || !item?.chunkCount) return;
    for (let index = 0; index < item.chunkCount; index++) {
      await deleteDoc(chunkReference(item.id, item.chunkVersion, index)).catch(warn);
    }
  }

  async function readChunkedFile(item) {
    const reads = [];
    for (let index = 0; index < item.chunkCount; index++) reads.push(getDoc(chunkReference(item.id, item.chunkVersion, index)));
    const snapshots = await Promise.all(reads);
    const parts = collectChunkParts(index => {
      const snapshot = snapshots[index];
      if (!snapshot.exists()) return null;
      const data = snapshot.data().data;
      return typeof data === "string" ? base64ToBytes(data) : data.toUint8Array();
    }, item.chunkCount);
    return new Blob([concatByteArrays(parts)], { type: item.mimeType || "application/octet-stream" });
  }

  return { writeFileChunks, deleteFileChunks, readChunkedFile };
}
