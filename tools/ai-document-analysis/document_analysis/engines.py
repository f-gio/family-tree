from __future__ import annotations

import hashlib
import time
from pathlib import Path

from .contracts import EngineRequest, EngineResult, TranscriptionEngine
from .florence_engine import Florence2Engine

DEFAULT_INSTRUCTIONS = """Transcription diplomatique : conserver graphies, accents, abréviations et ponctuation visibles.
Ne pas normaliser les noms, compléter les lacunes ni inventer les passages illisibles.
Signaler toute incertitude ; les sorties demeurent des propositions à vérifier humainement."""


class FixtureTextEngine:
    """Moteur local de test : renvoie le texte fourni, sans analyser l’image."""

    engine_id = "fixture-text"

    def transcribe(self, request: EngineRequest) -> EngineResult:
        started = time.perf_counter()
        text = request.configuration.get("text", "")
        if not isinstance(text, str):
            raise TypeError("La configuration fixture 'text' doit être du texte.")
        elapsed = round((time.perf_counter() - started) * 1000)
        return EngineResult(
            engine_id=self.engine_id,
            model_reference="fixture-text-v1 (aucune IA ; texte fourni par l’opérateur)",
            text=text,
            duration_ms=elapsed,
            cost_eur=0.0,
            cost_status="known",
            confidence="unknown",
            provenance={
                "kind": "deterministic-fixture",
                "image_read_by_engine": False,
                "run_id": request.run_id,
                "instructions_sha256": hashlib.sha256(request.instructions.encode("utf-8")).hexdigest(),
            },
        )


def available_engines(model_dir: str | Path | None = None) -> dict[str, TranscriptionEngine]:
    """Adaptateurs disponibles ; l’import des dépendances ML reste différé."""
    engines: dict[str, TranscriptionEngine] = {FixtureTextEngine.engine_id: FixtureTextEngine()}
    engines[Florence2Engine.engine_id] = Florence2Engine(model_dir=model_dir)
    return engines
