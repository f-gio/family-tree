const FIELD_SELECTOR = "input.field, select.field, textarea.field";

function labelText(field) {
  const label = field.closest("label");
  if (!label) return "ce champ";
  const clone = label.cloneNode(true);
  clone.querySelectorAll("input, select, textarea, .hint, .file-note, .field-error").forEach(node => node.remove());
  return clone.textContent.replace(/\s*\*\s*/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr-FR") || "ce champ";
}

function errorId(field) {
  if (!field.id) field.id = `field-${Math.random().toString(36).slice(2, 9)}`;
  return `${field.id}-error`;
}

function clearFieldError(field) {
  if (!field?.matches?.(FIELD_SELECTOR)) return;
  const id = errorId(field);
  document.getElementById(id)?.remove();
  field.removeAttribute("aria-invalid");
  const describedBy = (field.getAttribute("aria-describedby") || "").split(/\s+/).filter(value => value && value !== id);
  if (describedBy.length) field.setAttribute("aria-describedby", describedBy.join(" "));
  else field.removeAttribute("aria-describedby");
}

function showFieldError(field, message) {
  clearFieldError(field);
  const id = errorId(field);
  const error = document.createElement("span");
  error.className = "field-error";
  error.id = id;
  error.textContent = message;
  field.insertAdjacentElement("afterend", error);
  field.setAttribute("aria-invalid", "true");
  const describedBy = new Set((field.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean));
  describedBy.add(id);
  field.setAttribute("aria-describedby", [...describedBy].join(" "));
}

function browserValidationMessage(field) {
  const name = labelText(field);
  if (field.validity.valueMissing) return `Renseignez ${name}.`;
  if (field.validity.typeMismatch && field.type === "email") return "Saisissez une adresse e-mail complète, par exemple nom@domaine.fr.";
  if (field.validity.typeMismatch && field.type === "url") return "Saisissez une adresse complète commençant par https://.";
  if (field.validity.tooShort) return `${name[0].toUpperCase()}${name.slice(1)} doit contenir au moins ${field.minLength} caractères.`;
  if (field.validity.rangeUnderflow || field.validity.rangeOverflow) return `Saisissez une valeur comprise entre ${field.min} et ${field.max}.`;
  if (field.validity.badInput) return `Saisissez une valeur valide pour ${name}.`;
  return `Vérifiez ${name}.`;
}

function validateGenealogyDate(control) {
  const prefix = control.dataset.dateControl;
  const type = control.dataset.dateType || "unknown";
  if (type === "unknown") return null;
  if (type === "exact") {
    const field = document.getElementById(`${prefix}Date`);
    return field?.value ? null : { field, message: "Indiquez la date précise ou choisissez « Inconnue »." };
  }
  if (type === "year" || type === "about") {
    const field = document.getElementById(`${prefix}Year`);
    const year = Number(field?.value);
    return Number.isInteger(year) && year >= 1 && year <= 9999 ? null : { field, message: "Indiquez une année comprise entre 1 et 9999." };
  }
  const from = document.getElementById(`${prefix}YearFrom`);
  const to = document.getElementById(`${prefix}YearTo`);
  const fromYear = Number(from?.value);
  const toYear = Number(to?.value);
  if (!Number.isInteger(fromYear) || fromYear < 1 || fromYear > 9999) return { field: from, message: "Indiquez une année de début comprise entre 1 et 9999." };
  if (!Number.isInteger(toYear) || toYear < 1 || toYear > 9999) return { field: to, message: "Indiquez une année de fin comprise entre 1 et 9999." };
  if (fromYear > toYear) return { field: to, message: "L’année de fin doit être postérieure ou égale à l’année de début." };
  return null;
}

function validateFormDetails(form) {
  for (const control of form.querySelectorAll(".genealogy-date")) {
    const error = validateGenealogyDate(control);
    if (error?.field) return error;
  }
  if (form.id === "documentForm" && !document.getElementById("documentId")?.value) {
    const file = document.getElementById("documentFile");
    const url = document.getElementById("documentUrl");
    if (!file?.files?.length && !url?.value.trim()) return { field: file, message: "Choisissez un fichier ou indiquez un lien vers le document." };
  }
  if (form.id === "signupForm") {
    const password = document.getElementById("signupPassword");
    const confirmation = document.getElementById("signupPasswordConfirm");
    if (password?.value !== confirmation?.value) return { field: confirmation, message: "Les deux mots de passe doivent être identiques." };
  }
  return null;
}

document.addEventListener("invalid", event => {
  const field = event.target;
  if (!field.matches?.(FIELD_SELECTOR)) return;
  showFieldError(field, browserValidationMessage(field));
}, true);

document.addEventListener("input", event => {
  const field = event.target;
  if (!field.matches?.(FIELD_SELECTOR)) return;
  if (field.validity.valid) clearFieldError(field);
  if (["documentFile", "documentUrl"].includes(field.id)) {
    clearFieldError(document.getElementById("documentFile"));
    clearFieldError(document.getElementById("documentUrl"));
  }
}, true);

document.addEventListener("change", event => {
  const field = event.target;
  if (field.matches?.(FIELD_SELECTOR)) clearFieldError(field);
  if (["documentFile", "documentUrl"].includes(field.id)) {
    clearFieldError(document.getElementById("documentFile"));
    clearFieldError(document.getElementById("documentUrl"));
  }
}, true);

document.addEventListener("click", event => {
  const button = event.target.closest?.("[data-date-prefix]");
  if (!button) return;
  document.querySelector(`[data-date-control="${button.dataset.datePrefix}"]`)
    ?.querySelectorAll(FIELD_SELECTOR).forEach(clearFieldError);
});

document.addEventListener("submit", event => {
  const error = validateFormDetails(event.target);
  if (!error) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showFieldError(error.field, error.message);
  error.field.focus({ preventScroll: true });
  error.field.scrollIntoView({ behavior: "smooth", block: "center" });
}, true);

document.addEventListener("close", event => {
  if (!(event.target instanceof HTMLDialogElement)) return;
  event.target.querySelectorAll(FIELD_SELECTOR).forEach(clearFieldError);
}, true);
