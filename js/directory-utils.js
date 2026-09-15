export function normalizeDirectoryText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function directoryPersonName(item = {}) {
  return `${item.lastName || ""} ${item.firstName || ""} ${item.middleName || ""}`
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDirectoryDate(value, locale = "fr-FR") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return "—";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

export function directoryEventYear(item = {}, eventName = "birth") {
  const exactValue = String(item[`${eventName}Date`] || "");
  const match = exactValue.match(/^(\d{4})-/);
  return match ? Number(match[1]) : null;
}

export function directoryEventSortValue(item = {}, eventName = "birth") {
  const exactValue = String(item[`${eventName}Date`] || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(exactValue) ? Number(exactValue.replaceAll("-", "")) : null;
}

function compareNames(a, b) {
  return directoryPersonName(a).localeCompare(directoryPersonName(b), "fr", { sensitivity: "base" });
}

export function filterAndSortDirectory(people = [], filters = {}) {
  const query = normalizeDirectoryText(filters.query);
  const name = normalizeDirectoryText(filters.name);
  const place = normalizeDirectoryText(filters.place);
  const branch = String(filters.branch || "");
  const birthYear = Number.parseInt(filters.birthYear, 10) || null;
  const deathYear = Number.parseInt(filters.deathYear, 10) || null;

  const filtered = people.filter(item => {
    const searchableName = normalizeDirectoryText(`${item.lastName || ""} ${item.marriedName || ""} ${item.firstName || ""} ${item.middleName || ""}`);
    const familyNames = normalizeDirectoryText(`${item.lastName || ""} ${item.marriedName || ""}`);
    const places = normalizeDirectoryText(`${item.place || ""} ${item.deathPlace || ""}`);
    return (!query || searchableName.includes(query))
      && (!name || familyNames.includes(name))
      && (!place || places.includes(place))
      && (!branch || item.branch === branch)
      && (!birthYear || directoryEventYear(item, "birth") === birthYear)
      && (!deathYear || directoryEventYear(item, "death") === deathYear);
  });

  const sort = filters.sort || "name-asc";
  filtered.sort((a, b) => {
    if (sort === "name-desc") return compareNames(b, a);
    if (sort === "birth-asc" || sort === "birth-desc") {
      const dateA = directoryEventSortValue(a, "birth");
      const dateB = directoryEventSortValue(b, "birth");
      if (dateA == null && dateB == null) return compareNames(a, b);
      if (dateA == null) return 1;
      if (dateB == null) return -1;
      const dateOrder = sort === "birth-asc" ? dateA - dateB : dateB - dateA;
      return dateOrder || compareNames(a, b);
    }
    return compareNames(a, b);
  });
  return filtered;
}
