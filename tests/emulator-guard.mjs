// Garde anti-production pour la suite d'intégration Firestore Emulator.
// Module pur : aucune dépendance au DOM, importable dans node:test.
// Refuse tout démarrage si l'émulateur n'est pas local ou si le projectId est réel.

export const REAL_PROJECT_ID = "family-tree-c2fe2";
export const EMULATOR_PROJECT_ID = "family-tree-emulator-test";

export function parseEmulatorEnv(env = {}) {
  const hostValue = env.FIRESTORE_EMULATOR_HOST;
  if (!hostValue || typeof hostValue !== "string") {
    throw new Error(
      "GARDE ANTI-PRODUCTION : FIRESTORE_EMULATOR_HOST absent. Lancez la suite via 'npm run test:firestore' (firebase emulators:exec) ; n'exécutez jamais le fichier de test directement (il n'irait JAMAIS vers la production)."
    );
  }
  const match = hostValue.match(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
  if (!match) {
    throw new Error(
      `GARDE ANTI-PRODUCTION : FIRESTORE_EMULATOR_HOST='${hostValue}' n'est pas un hôte local (localhost/127.0.0.1). Refus de démarrer : aucun contact réseau avec la production.`
    );
  }
  const port = match[2] ? parseInt(match[2].slice(1), 10) : 8080;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`GARDE ANTI-PRODUCTION : port invalide '${port}' dans '${hostValue}'.`);
  }
  return { host: match[1], port };
}

export function assertFictiveProject(projectId) {
  if (projectId === REAL_PROJECT_ID) {
    throw new Error(
      `GARDE ANTI-PRODUCTION : projectId réel '${projectId}' refusé pour des tests d'intégration. Utilisez '${EMULATOR_PROJECT_ID}' (project fictif).`
    );
  }
  return projectId;
}

export function assertLocalEmulator(env = process.env) {
  const config = parseEmulatorEnv(env);
  if (config.host !== "localhost" && config.host !== "127.0.0.1") {
    throw new Error(`GARDE ANTI-PRODUCTION : hôte non local '${config.host}'.`);
  }
  return config;
}