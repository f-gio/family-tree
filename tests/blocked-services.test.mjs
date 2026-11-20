import test from "node:test";
import assert from "node:assert/strict";
import { blockedServiceFor, isAllowedRequest } from "./helpers.mjs";

/* Isolation réseau des tests d'interface : les émulateurs Firebase sont
   bloqués sur la boucle locale comme sur une IP privée (configuration LAN),
   uniquement sur leurs ports, pour que les connexions indésirables soient
   interceptées — jamais pour masquer une erreur. */

test("les émulateurs Firebase locaux sont bloqués sur leurs ports, quelle que soit l’interface", () => {
  const emulatorUrls = [
    "http://127.0.0.1:8080/",
    "http://localhost:8080/",
    "http://127.0.0.1:9099/",
    "http://localhost:9099/",
    "http://[::1]:8080/",
    "http://192.168.1.14:8080/",
    "http://192.168.1.14:9099/",
    "http://10.0.0.5:8080/",
    "http://172.31.0.9:9099/"
  ];
  for (const url of emulatorUrls) assert.ok(blockedServiceFor(url), `${url} doit être bloqué`);
});

test("le blocage ne s’applique jamais par port seul", () => {
  /* Le serveur statique des tests écoute sur un port éphémère : il ne doit
     jamais être confondu avec un émulateur, même sur une IP privée. */
  assert.equal(blockedServiceFor("http://127.0.0.1:54321/"), null, "port éphémère sur la boucle locale non bloqué");
  assert.equal(blockedServiceFor("http://192.168.1.14:54321/"), null, "port éphémère sur une IP privée non bloqué");
  assert.equal(blockedServiceFor("https://example.test:8080/"), null, "un hôte public sur le port 8080 n’est pas un émulateur");
  assert.equal(blockedServiceFor("https://example.test:9099/"), null, "un hôte public sur le port 9099 n’est pas un émulateur");
});

test("les services distants restent interdits dans les tests d’interface", () => {
  assert.ok(blockedServiceFor("https://firestore.googleapis.com/"), "Firestore distant bloqué");
  assert.ok(blockedServiceFor("https://identitytoolkit.googleapis.com/"), "Authentication distante bloquée");
  assert.ok(blockedServiceFor("https://securetoken.googleapis.com/"), "jeton distant bloqué");
  assert.ok(blockedServiceFor("https://api.geonames.org/"), "GeoNames bloqué");
  assert.ok(blockedServiceFor("https://relais.giovannoni-f.workers.dev/"), "relais Cloudflare bloqué");
  assert.ok(blockedServiceFor("https://cdn.jsdelivr.net/npm/jszip/+esm"), "jsDelivr bloqué");
});

test("les requêtes du serveur local de tests restent autorisées", () => {
  const baseURL = "http://127.0.0.1:54321/";
  assert.ok(isAllowedRequest(`${baseURL}index.html`, baseURL), "ressource du serveur local autorisée");
  assert.ok(isAllowedRequest("https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js", baseURL), "SDK Firebase en cache local autorisé");
  assert.equal(isAllowedRequest("https://firestore.googleapis.com/", baseURL), false, "service distant non autorisé");
});
