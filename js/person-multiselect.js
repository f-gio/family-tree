export function createPersonMultiSelect({
  kind,
  root,
  input,
  chips,
  results,
  dialog,
  minQueryLength = 2,
  findMatches,
  suggestionFor,
  nameFor,
  escapeHtml
}) {
  let selectedIds = new Set();
  let matches = [];
  let highlightedIndex = -1;
  const addAttribute = `data-add-${kind}-person`;
  const removeAttribute = `data-remove-${kind}-person`;

  function renderChips() {
    chips.innerHTML = [...selectedIds].map(id => {
      const name = nameFor(id);
      return `<span class="person-multiselect-chip"><span class="person-multiselect-chip-label">${escapeHtml(name)}</span><button class="person-multiselect-chip-remove" type="button" ${removeAttribute}="${escapeHtml(id)}" aria-label="Retirer ${escapeHtml(name)} de la sélection">×</button></span>`;
    }).join("");
  }

  function renderResults() {
    if (!matches.length) {
      results.innerHTML = "";
      results.hidden = true;
      input.setAttribute("aria-expanded", "false");
      return;
    }
    results.innerHTML = matches.map((item, index) => {
      const { label, context = "" } = suggestionFor(item);
      return `<button class="person-multiselect-result${index === highlightedIndex ? " is-active" : ""}" type="button" role="option" aria-selected="${index === highlightedIndex ? "true" : "false"}" ${addAttribute}="${escapeHtml(item.id)}" tabindex="-1"><span class="person-multiselect-result-name">${escapeHtml(label)}</span>${context ? `<span class="person-multiselect-result-context">${escapeHtml(context)}</span>` : ""}</button>`;
    }).join("");
    results.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function closeResults() {
    matches = [];
    highlightedIndex = -1;
    renderResults();
  }

  function openResults() {
    if (String(input.value).trim().length < minQueryLength) {
      closeResults();
      return;
    }
    matches = findMatches(input.value, selectedIds);
    highlightedIndex = matches.length ? 0 : -1;
    renderResults();
  }

  function setSelected(ids = []) {
    selectedIds = new Set(ids);
    renderChips();
    input.value = "";
    closeResults();
  }

  function add(id) {
    if (!id || selectedIds.has(id)) return;
    selectedIds.add(id);
    renderChips();
    input.value = "";
    closeResults();
    input.focus();
  }

  function remove(id) {
    selectedIds.delete(id);
    renderChips();
  }

  function activate(delta) {
    if (!matches.length) return;
    highlightedIndex = (highlightedIndex + delta + matches.length) % matches.length;
    renderResults();
    results.querySelectorAll(`[${addAttribute}]`)[highlightedIndex]?.focus();
  }

  input.addEventListener("input", openResults);
  input.addEventListener("focus", openResults);
  input.addEventListener("keydown", event => {
    if (event.key === "Escape" && !results.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeResults();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      activate(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" && matches.length) {
      event.preventDefault();
      add(matches[highlightedIndex]?.id);
    }
  });
  root.addEventListener("click", event => {
    const addButton = event.target.closest(`[${addAttribute}]`);
    if (addButton) return add(addButton.getAttribute(addAttribute));
    const removeButton = event.target.closest(`[${removeAttribute}]`);
    if (removeButton) remove(removeButton.getAttribute(removeAttribute));
  });
  root.ownerDocument.addEventListener("click", event => {
    if (!results.hidden && !root.contains(event.target)) closeResults();
  });
  dialog?.addEventListener("cancel", event => {
    if (root.ownerDocument.activeElement === input && !results.hidden) event.preventDefault();
  });

  return {
    setSelected,
    getSelected: () => [...selectedIds],
    getMatches: () => [...matches],
    closeResults
  };
}
