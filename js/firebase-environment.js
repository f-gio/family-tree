/* Résolution stricte des projets Firebase selon l'origine de la page.
   Module pur : aucune lecture de window/document à l'import. */

export const FIREBASE_PROJECT_IDS = Object.freeze({
  production: "family-tree-c2fe2",
  recette: "la-nostra-storia-recette",
  local: "family-tree-emulator-test"
});

const firebaseConfigs = Object.freeze({
  production: Object.freeze({
    apiKey: "AIzaSyCJEcONT97K3y0MqsiPORRjWfNj8XZGfM8",
    authDomain: "family-tree-c2fe2.firebaseapp.com",
    projectId: "family-tree-c2fe2",
    messagingSenderId: "1096091899254",
    appId: "1:1096091899254:web:4afff8d04448409d969657"
  }),
  recette: Object.freeze({
    apiKey: "AIzaSyDZC8JANaZetj33v8oLDS6Esz-3Fmeegvc",
    authDomain: "la-nostra-storia-recette.firebaseapp.com",
    projectId: "la-nostra-storia-recette",
    storageBucket: "la-nostra-storia-recette.firebasestorage.app",
    messagingSenderId: "69667950287",
    appId: "1:69667950287:web:52274e0cf6f4cbc11771ba"
  }),
  local: Object.freeze({
    apiKey: "local-emulator-only",
    projectId: "family-tree-emulator-test"
  })
});

export function firebaseProjectIdMatches(environment, config) {
  const expected = FIREBASE_PROJECT_IDS[environment];
  return typeof expected === "string" && config?.projectId === expected;
}

export function firebaseConfigurationMatchesEnvironment(environment, config) {
  const expected = firebaseConfigs[environment];
  return !!expected
    && firebaseProjectIdMatches(environment, config)
    && Object.entries(expected).every(([key, value]) => config?.[key] === value);
}

function denied(reason) {
  return Object.freeze({ allowed: false, environment: "unknown", reason });
}

function allow(environment) {
  const firebaseConfig = firebaseConfigs[environment];
  if (!firebaseConfigurationMatchesEnvironment(environment, firebaseConfig)) return denied("firebase-config-mismatch");
  const result = { allowed: true, environment, firebaseConfig };
  if (environment === "local") {
    result.emulators = Object.freeze({
      auth: Object.freeze({ host: "127.0.0.1", port: 9099 }),
      firestore: Object.freeze({ host: "127.0.0.1", port: 8080 })
    });
  }
  return Object.freeze(result);
}

export function resolveFirebaseEnvironment(locationLike) {
  const hostname = typeof locationLike?.hostname === "string" ? locationLike.hostname.toLowerCase() : "";
  const protocol = typeof locationLike?.protocol === "string" ? locationLike.protocol : "";
  const pathname = typeof locationLike?.pathname === "string" ? locationLike.pathname : "";

  if (hostname === "f-gio.github.io") {
    const isProjectPath = pathname === "/family-tree" || pathname.startsWith("/family-tree/");
    return protocol === "https:" && isProjectPath ? allow("production") : denied("production-origin-or-path-mismatch");
  }
  if (hostname === "la-nostra-storia-recette.web.app") {
    return protocol === "https:" ? allow("recette") : denied("recette-requires-https");
  }
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return protocol === "http:" || protocol === "https:" ? allow("local") : denied("local-origin-invalid");
  }
  return denied("unrecognized-hostname");
}
