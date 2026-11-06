export const NAME_VARIANT_KINDS = Object.freeze(["given", "family"]);

const NAME_VARIANT_LABELS = Object.freeze({ given: "Prénom", family: "Nom" });

export function nameVariantLabel(kind) {
  return NAME_VARIANT_LABELS[kind] || "";
}

export function normalizeNameVariantValue(value = "") {
  return String(value ?? "").trim();
}

function normalizeForCompare(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function personNameVariants(person = {}) {
  if (!Array.isArray(person?.nameVariants)) return [];
  return person.nameVariants.filter(variant => variant
    && typeof variant.id === "string" && variant.id
    && NAME_VARIANT_KINDS.includes(variant.kind)
    && typeof variant.value === "string"
    && normalizeNameVariantValue(variant.value));
}

export function validateNameVariant({ kind, value, firstName = "", lastName = "", existing = [] } = {}) {
  const trimmed = normalizeNameVariantValue(value);
  if (!NAME_VARIANT_KINDS.includes(kind)) return { ok: false, error: "Choisissez Prénom ou Nom." };
  if (!trimmed) return { ok: false, error: "Saisissez une variante." };
  const principal = normalizeForCompare(kind === "given" ? firstName : lastName);
  if (principal && normalizeForCompare(trimmed) === principal) {
    return { ok: false, error: kind === "given" ? "Cette variante est identique au prénom principal." : "Cette variante est identique au nom de naissance." };
  }
  const duplicate = personNameVariants({ nameVariants: existing })
    .some(variant => variant.kind === kind && normalizeForCompare(variant.value) === normalizeForCompare(trimmed));
  if (duplicate) return { ok: false, error: "Cette variante existe déjà pour ce type." };
  return { ok: true, value: trimmed };
}

export function personNameVariantsSearchText(person = {}, kind = null) {
  return personNameVariants(person)
    .filter(variant => !kind || variant.kind === kind)
    .map(variant => variant.value)
    .join(" ");
}

export function nameVariantsWritePlan(draft = [], isUpdate = false) {
  const list = personNameVariants({ nameVariants: draft });
  if (list.length) return { action: "set", value: list.map(variant => ({ ...variant })) };
  return isUpdate ? { action: "delete" } : { action: "omit" };
}
