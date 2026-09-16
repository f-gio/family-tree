const DEFAULT_ENDPOINT = "https://api.geonames.org/searchJSON";
const sharedCache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
const CACHE_LIMIT = 80;

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function uniqueParts(values) {
  const seen = new Set();
  return values.filter(value => {
    const normalized = clean(value);
    const key = normalized.toLocaleLowerCase("fr");
    if (!normalized || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function normalizeGeoNamesLocation(result = {}) {
  const name = clean(result.name || result.toponymName);
  const country = clean(result.countryName);
  const regionParts = uniqueParts([result.adminName2, result.adminName1])
    .filter(value => ![name, country].some(other => other && value.toLocaleLowerCase("fr") === other.toLocaleLowerCase("fr")));
  return {
    name,
    region: regionParts.join(", "),
    country,
    countryCode: clean(result.countryCode).toUpperCase(),
    geonamesId: Number.isFinite(Number(result.geonameId)) ? Number(result.geonameId) : null
  };
}

export function sanitizeStoredLocation(value) {
  if (!value || typeof value !== "object") return null;
  const normalized = {
    name: clean(value.name),
    region: clean(value.region),
    country: clean(value.country),
    countryCode: clean(value.countryCode).toUpperCase(),
    geonamesId: Number.isFinite(Number(value.geonamesId)) ? Number(value.geonamesId) : null
  };
  return normalized.name ? normalized : null;
}

export function formatLocationSuggestion(location = {}) {
  const normalized = sanitizeStoredLocation(location) || normalizeGeoNamesLocation(location);
  const context = uniqueParts([normalized.region, normalized.country]);
  return context.length ? `${normalized.name} — ${context.join(", ")}` : normalized.name;
}

export function buildGeoNamesUrl(query, { username, maxResults = 8, language = "fr", endpoint = DEFAULT_ENDPOINT } = {}) {
  const target = new URL(endpoint);
  if (!target.hostname.endsWith("geonames.org")) {
    target.searchParams.set("q", clean(query));
    return target.toString();
  }
  const params = new URLSearchParams({
    name_startsWith: clean(query),
    featureClass: "P",
    maxRows: String(Math.min(Math.max(Number(maxResults) || 8, 1), 8)),
    orderby: "relevance",
    style: "FULL",
    lang: language,
    username: clean(username)
  });
  return `${endpoint}?${params}`;
}

export function createGeoNamesSearch({ username, fetchImpl = globalThis.fetch, maxResults = 8, language = "fr", endpoint = DEFAULT_ENDPOINT, now = () => Date.now() } = {}) {
  const configuredUsername = clean(username);
  const usesDirectGeoNames = new URL(endpoint).hostname.endsWith("geonames.org");
  return async function searchPlaces(query, { signal } = {}) {
    const normalizedQuery = clean(query);
    if (normalizedQuery.length < 3) return [];
    if (usesDirectGeoNames && !configuredUsername) {
      const error = new Error("GeoNames n’est pas encore configuré");
      error.code = "geonames/not-configured";
      throw error;
    }
    const cacheKey = `${endpoint}:${language}:${normalizedQuery.toLocaleLowerCase("fr")}`;
    const cached = sharedCache.get(cacheKey);
    if (cached && now() - cached.createdAt < CACHE_TTL) return cached.items;
    const response = await fetchImpl(buildGeoNamesUrl(normalizedQuery, { username: configuredUsername, maxResults, language, endpoint }), { signal });
    if (!response.ok) throw new Error(`GeoNames est indisponible (${response.status})`);
    const payload = await response.json();
    if (payload.status?.message) throw new Error(payload.status.message);
    const seen = new Set();
    const items = (payload.geonames || []).map(normalizeGeoNamesLocation).filter(item => {
      const key = item.geonamesId || `${item.name}|${item.region}|${item.country}`;
      if (!item.name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, maxResults);
    sharedCache.set(cacheKey, { createdAt: now(), items });
    while (sharedCache.size > CACHE_LIMIT) sharedCache.delete(sharedCache.keys().next().value);
    return items;
  };
}

export function geoNamesUsernameFromDocument(source = globalThis.document) {
  const value = source?.querySelector?.('meta[name="geonames-username"]')?.content;
  return clean(value).replace(/^YOUR_GEONAMES_USERNAME$/i, "");
}

export function geoNamesEndpointFromDocument(source = globalThis.document) {
  const value = source?.querySelector?.('meta[name="geonames-endpoint"]')?.content;
  return clean(value) || DEFAULT_ENDPOINT;
}

export function createLocationAutocomplete({ input, username, endpoint = DEFAULT_ENDPOINT, minChars = 3, debounceMs = 320, maxResults = 8, searchPlaces, documentRef = globalThis.document } = {}) {
  if (!input || !documentRef) throw new Error("Un champ de lieu est requis");
  const search = searchPlaces || createGeoNamesSearch({ username, endpoint, maxResults });
  const wrapper = documentRef.createElement("div");
  wrapper.className = "location-autocomplete";
  input.before(wrapper);
  wrapper.append(input);

  const status = documentRef.createElement("span");
  status.className = "location-autocomplete-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  wrapper.append(status);

  const list = documentRef.createElement("div");
  const listId = `${input.id || "location"}-suggestions`;
  list.id = listId;
  list.className = "location-suggestions";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  const host = input.closest("dialog") || documentRef.body;
  host.append(list);

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");
  input.setAttribute("autocomplete", "off");

  let selected = null;
  let results = [];
  let activeIndex = -1;
  let timer = 0;
  let request = null;

  function setStatus(message = "") {
    status.textContent = message;
    status.hidden = !message;
  }

  function closeList() {
    list.hidden = true;
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function positionList() {
    if (list.hidden) return;
    const inputRect = input.getBoundingClientRect();
    const boundary = host instanceof HTMLDialogElement ? host.getBoundingClientRect() : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    const margin = 8;
    const left = Math.max(boundary.left + margin, Math.min(inputRect.left, boundary.right - inputRect.width - margin));
    const width = Math.min(inputRect.width, boundary.right - boundary.left - margin * 2);
    const roomBelow = boundary.bottom - inputRect.bottom - margin;
    const roomAbove = inputRect.top - boundary.top - margin;
    const placeAbove = roomBelow < 150 && roomAbove > roomBelow;
    list.style.left = `${left}px`;
    list.style.width = `${Math.max(width, 180)}px`;
    list.style.maxHeight = `${Math.max(96, Math.min(288, placeAbove ? roomAbove : roomBelow))}px`;
    list.style.top = placeAbove ? `${Math.max(boundary.top + margin, inputRect.top - list.offsetHeight - 4)}px` : `${inputRect.bottom + 4}px`;
  }

  function setActive(index) {
    activeIndex = results.length ? (index + results.length) % results.length : -1;
    list.querySelectorAll("[role=option]").forEach((option, optionIndex) => {
      const active = optionIndex === activeIndex;
      option.classList.toggle("is-active", active);
      option.setAttribute("aria-selected", String(active));
      if (active) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
  }

  function choose(location) {
    selected = sanitizeStoredLocation(location);
    input.value = selected?.name || input.value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    setStatus("");
    closeList();
  }

  function render(items) {
    results = items;
    activeIndex = -1;
    list.replaceChildren();
    if (!items.length) {
      closeList();
      setStatus("Aucun lieu proposé · la saisie libre reste disponible.");
      return;
    }
    items.forEach((location, index) => {
      const option = documentRef.createElement("button");
      option.type = "button";
      option.id = `${listId}-${index}`;
      option.className = "location-suggestion";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = formatLocationSuggestion(location);
      option.addEventListener("pointerdown", event => {
        event.preventDefault();
        choose(location);
      });
      list.append(option);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setStatus("");
    requestAnimationFrame(positionList);
  }

  async function runSearch(query) {
    request?.abort();
    request = new AbortController();
    setStatus("Recherche de lieux…");
    try {
      render(await search(query, { signal: request.signal }));
    } catch (error) {
      if (error.name === "AbortError") return;
      closeList();
      setStatus(error.code === "geonames/not-configured"
        ? "Suggestions GeoNames non configurées · la saisie libre reste disponible."
        : "Suggestions indisponibles · la saisie libre reste disponible.");
    }
  }

  function onInput() {
    const value = input.value;
    if (!selected || value !== selected.name) selected = null;
    clearTimeout(timer);
    request?.abort();
    closeList();
    if (clean(value).length < minChars) {
      setStatus("");
      return;
    }
    timer = setTimeout(() => runSearch(value), debounceMs);
  }

  function onKeyDown(event) {
    if (event.key === "Escape") {
      closeList();
      setStatus("");
      return;
    }
    if (list.hidden || !results.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setActive(activeIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      choose(results[activeIndex]);
    }
  }

  function onOutsidePointer(event) {
    if (event.target !== input && !list.contains(event.target)) closeList();
  }

  input.addEventListener("input", onInput);
  input.addEventListener("keydown", onKeyDown);
  input.addEventListener("focus", () => { if (results.length && clean(input.value).length >= minChars) { list.hidden = false; input.setAttribute("aria-expanded", "true"); positionList(); } });
  documentRef.addEventListener("pointerdown", onOutsidePointer, true);
  documentRef.addEventListener("scroll", positionList, true);
  globalThis.addEventListener?.("resize", positionList);

  return {
    setValue(value = "", placeInfo = null) {
      clearTimeout(timer);
      request?.abort();
      input.value = value || "";
      selected = sanitizeStoredLocation(placeInfo);
      results = [];
      setStatus("");
      closeList();
    },
    getValue() {
      return { text: input.value.trim(), placeInfo: selected ? { ...selected } : null };
    },
    snapshot() {
      return { text: input.value, placeInfo: selected ? { ...selected } : null };
    },
    close: closeList,
    destroy() {
      clearTimeout(timer);
      request?.abort();
      input.removeEventListener("input", onInput);
      input.removeEventListener("keydown", onKeyDown);
      documentRef.removeEventListener("pointerdown", onOutsidePointer, true);
      documentRef.removeEventListener("scroll", positionList, true);
      globalThis.removeEventListener?.("resize", positionList);
      list.remove();
    }
  };
}
