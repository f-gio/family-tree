export function documentDisplayLabel(item = {}) {
  return String(item.title || "").trim()
    || String(item.type || "").trim()
    || String(item.fileName || "").trim()
    || "Document";
}
