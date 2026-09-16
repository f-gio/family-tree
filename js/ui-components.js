const ICON_NAMES = new Set([
  "tree", "people", "document", "tasks", "link", "plus", "search", "filter",
  "list", "grid", "chevron-down", "close", "eye", "edit", "trash", "unlink",
  "arrow-right", "download", "upload", "user", "database", "shield", "logout",
  "check", "info", "error", "empty", "zoom-in", "zoom-out", "fit", "center"
]);

export function icon(name, className = "") {
  const safeName = ICON_NAMES.has(name) ? name : "info";
  const classes = ["ui-icon", className].filter(Boolean).join(" ");
  return `<svg class="${classes}" aria-hidden="true" focusable="false"><use href="#icon-${safeName}"></use></svg>`;
}

export function emptyState({ iconName = "empty", title, description = "", action = "" }) {
  return `<div class="empty-state" role="status">
    <span class="empty-state-icon" aria-hidden="true">${icon(iconName, "ui-icon-lg")}</span>
    <h3>${title}</h3>
    ${description ? `<p>${description}</p>` : ""}
    ${action ? `<div class="empty-state-action">${action}</div>` : ""}
  </div>`;
}

export function setButtonPending(button, pending, pendingLabel = "Enregistrement…") {
  if (!button) return;
  if (pending) {
    if (!button.dataset.idleLabel) button.dataset.idleLabel = button.textContent.trim();
    if (typeof button.innerHTML === "string" && !button.dataset.idleContent) button.dataset.idleContent = button.innerHTML;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = pendingLabel;
    return;
  }
  button.disabled = false;
  button.removeAttribute("aria-busy");
  if (button.dataset.idleContent && typeof button.innerHTML === "string") button.innerHTML = button.dataset.idleContent;
  else if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
  delete button.dataset.idleLabel;
  delete button.dataset.idleContent;
}

export async function withButtonPending(button, action, pendingLabel = "Enregistrement…") {
  setButtonPending(button, true, pendingLabel);
  try { return await action(); }
  finally { setButtonPending(button, false); }
}
