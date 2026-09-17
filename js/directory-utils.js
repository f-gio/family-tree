import { formatGenealogyDate, genealogyDateMatchesYear, genealogyDateSortValue } from "./genealogy-date.js";

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

export function formatDirectoryDate(value, legacyExact = "", locale = "fr-FR") {
  return formatGenealogyDate(value, legacyExact, locale);
}

export function directoryEventYear(item = {}, eventName = "birth") {
  const value = item[`${eventName}DateInfo`], legacy = item[`${eventName}Date`];
  const sortValue = genealogyDateSortValue(value, legacy);
  return sortValue == null ? null : Math.floor(sortValue / 10000);
}

export function directoryEventSortValue(item = {}, eventName = "birth") {
  return genealogyDateSortValue(item[`${eventName}DateInfo`], item[`${eventName}Date`]);
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
      && (!birthYear || genealogyDateMatchesYear(item.birthDateInfo, item.birthDate, birthYear))
      && (!deathYear || genealogyDateMatchesYear(item.deathDateInfo, item.deathDate, deathYear));
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
