// Tests unitaires de la garde anti-production de la suite Firestore Emulator.
// Tests purs (aucun réseau, aucun émulateur requis), auto-découverts par node --test.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEmulatorEnv, assertLocalEmulator, assertFictiveProject, REAL_PROJECT_ID, EMULATOR_PROJECT_ID } from "./emulator-guard.mjs";

describe("parseEmulatorEnv", () => {
  it("rejette l'absence de FIRESTORE_EMULATOR_HOST", () => {
    assert.throws(() => parseEmulatorEnv({}), /FIRESTORE_EMULATOR_HOST absent/);
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "" }), /FIRESTORE_EMULATOR_HOST absent/);
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: undefined }), /FIRESTORE_EMULATOR_HOST absent/);
  });

  it("rejette un hôte distant ou un hostname non local", () => {
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "192.168.1.10:8080" }), /pas un hôte local/);
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "10.0.0.5:8080" }), /pas un hôte local/);
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "example.com:8080" }), /pas un hôte local/);
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "firestore.googleapis.com:443" }), /pas un hôte local/);
  });

  it("accepte localhost et 127.0.0.1 avec port explicite ou défaut 8080", () => {
    assert.deepEqual(parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "localhost:8080" }), { host: "localhost", port: 8080 });
    assert.deepEqual(parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }), { host: "127.0.0.1", port: 8080 });
    assert.deepEqual(parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "localhost:9099" }), { host: "localhost", port: 9099 });
    assert.deepEqual(parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "127.0.0.1" }), { host: "127.0.0.1", port: 8080 });
  });

  it("rejette un port numériquement invalide", () => {
    assert.throws(() => parseEmulatorEnv({ FIRESTORE_EMULATOR_HOST: "localhost:abc" }), /pas un hôte local/);
  });
});

describe("assertFictiveProject", () => {
  it("refuse explicitement le projectId réel", () => {
    assert.throws(() => assertFictiveProject(REAL_PROJECT_ID), /projectId réel/);
  });

  it("accepte le projectId fictif dédié aux émulateurs", () => {
    assert.equal(assertFictiveProject(EMULATOR_PROJECT_ID), EMULATOR_PROJECT_ID);
  });
});

describe("assertLocalEmulator", () => {
  it("retourne la configuration pour un hôte local strict", () => {
    const config = assertLocalEmulator({ FIRESTORE_EMULATOR_HOST: "localhost:8080" });
    assert.equal(config.host, "localhost");
    assert.equal(config.port, 8080);
  });

  it("lève une erreur en absence de configuration", () => {
    assert.throws(() => assertLocalEmulator({}), /FIRESTORE_EMULATOR_HOST absent/);
  });
});