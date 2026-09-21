import { normalizeGenealogyDate, genealogyDateYears } from "./genealogy-date.js";

export function normalizeDirectoryText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function validYear(value) {
  const year = Number.parseInt(value, 10);
  return Number.isInteger(year) && year >= 1 && year <= 9999 ? year : null;
}

export function genealogyDateOverlapsRange(value, legacyExact, from, to) {
  const rangeFrom = validYear(from);
  const rangeTo = validYear(to);
  if (rangeFrom == null && rangeTo == null) return true;
  const date = normalizeGenealogyDate(value, legacyExact);
  const years = genealogyDateYears(date);
  if (years.length === 0) return false;
  const dateFrom = Math.min(...years);
  const dateTo = Math.max(...years);
  if (rangeFrom != null && dateTo < rangeFrom) return false;
  if (rangeTo != null && dateFrom > rangeTo) return false;
  return true;
}

export function hasDeathInformation(person = {}) {
  const deathDate = normalizeGenealogyDate(person.deathDateInfo, person.deathDate);
  if (deathDate.type !== "unknown") return true;
  if (person.deathPlace) return true;
  if (person.deathPlaceInfo && typeof person.deathPlaceInfo === "object") return true;
  return false;
}

function compareNames(a, b) {
  const name = (item) => `${item.lastName || ""} ${item.firstName || ""} ${item.middleName || ""}`.replace(/\s+/g, " ").trim();
  return name(a).localeCompare(name(b), "fr", { sensitivity: "base" });
}

function textTokenMatch(text, term) {
  if (!term) return true;
  const normalized = normalizeDirectoryText(text);
  if (!normalized) return false;
  return normalized.split(/[\s,.\-;]+/).filter(Boolean).some(token => token.startsWith(term));
}

export function countActiveDirectoryFilters(filters = {}) {
  let count = 0;
  if (filters.firstName?.trim()) count++;
  if (filters.marriedName?.trim()) count++;
  if (filters.gender) count++;
  if (filters.branch) count++;
  if (filters.birthPlace?.trim()) count++;
  if (filters.birthYearFrom || filters.birthYearTo) count++;
  if (filters.deathPlace?.trim()) count++;
  if (filters.deathYearFrom || filters.deathYearTo) count++;
  if (filters.deathInfo) count++;
  return count;
}

function directoryEventSortValue(item = {}, eventName = "birth") {
  const value = item[`${eventName}DateInfo`], legacy = item[`${eventName}Date`];
  const date = normalizeGenealogyDate(value, legacy);
  if (date.type === "exact") return Number(date.value.replaceAll("-", ""));
  if (date.type === "year" || date.type === "about") return date.year * 10000 + 500;
  if (date.type === "between") return Math.round((date.from + date.to) / 2) * 10000 + 500;
  return null;
}

function searchablePlace(person = {}, prefix) {
  const textKey = prefix === "birth" ? "place" : "deathPlace";
  const infoKey = prefix === "birth" ? "birthPlaceInfo" : "deathPlaceInfo";
  const parts = [person[textKey] || ""];
  const info = person[infoKey];
  if (info && typeof info === "object") {
    if (info.name) parts.push(info.name);
    if (info.adminName1) parts.push(info.adminName1);
    if (info.adminName2) parts.push(info.adminName2);
    if (info.countryName) parts.push(info.countryName);
  }
  return parts.join(" ");
}

export function filterAndSortDirectory(people = [], filters = {}) {
  const query = normalizeDirectoryText(filters.query);
  const firstName = normalizeDirectoryText(filters.firstName);
  const marriedName = normalizeDirectoryText(filters.marriedName);
  const gender = filters.gender || "";
  const branch = String(filters.branch || "");
  const birthPlace = normalizeDirectoryText(filters.birthPlace);
  const deathPlace = normalizeDirectoryText(filters.deathPlace);
  const deathInfo = filters.deathInfo || "";

  const filtered = people.filter(item => {
    const quickSearch = normalizeDirectoryText(`${item.firstName || ""} ${item.middleName || ""} ${item.lastName || ""} ${item.marriedName || ""}`);
    const nameSearch = normalizeDirectoryText(`${item.firstName || ""} ${item.middleName || ""} ${item.lastName || ""}`);
    const marriedNameText = normalizeDirectoryText(item.marriedName || "");
    const birthPlaceText = searchablePlace(item, "birth");
    const deathPlaceText = searchablePlace(item, "death");
    return (!query || quickSearch.includes(query))
      && (!firstName || nameSearch.includes(firstName))
      && (!marriedName || marriedNameText.includes(marriedName))
      && (!gender || item.gender === gender)
      && (!branch || item.branch === branch)
      && (!birthPlace || textTokenMatch(birthPlaceText, birthPlace))
      && (!deathPlace || textTokenMatch(deathPlaceText, deathPlace))
      && genealogyDateOverlapsRange(item.birthDateInfo, item.birthDate, filters.birthYearFrom, filters.birthYearTo)
      && genealogyDateOverlapsRange(item.deathDateInfo, item.deathDate, filters.deathYearFrom, filters.deathYearTo)
      && (!deathInfo || (deathInfo === "yes" ? hasDeathInformation(item) : !hasDeathInformation(item)));
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

export const directoryFilterGroups = [{
  id: "identity",
  label: "Identité",
  fields: ["firstName", "marriedName", "gender", "branch"]
}, {
  id: "birth",
  label: "Naissance",
  fields: ["birthPlace", "birthYearFrom", "birthYearTo"]
}, {
  id: "death",
  label: "Décès",
  fields: ["deathPlace", "deathYearFrom", "deathYearTo", "deathInfo"]
}];
