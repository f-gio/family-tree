from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol


@dataclass(frozen=True)
class EngineRequest:
    image_path: Path
    document_id: str
    run_id: str
    configuration: dict[str, Any]
    instructions: str


@dataclass(frozen=True)
class EngineResult:
    engine_id: str
    model_reference: str | None
    text: str
    duration_ms: int
    cost_eur: float | None
    cost_status: str
    confidence: str
    errors: tuple[dict[str, Any], ...] = ()
    provenance: dict[str, Any] = field(default_factory=dict)


class TranscriptionEngine(Protocol):
    engine_id: str

    def transcribe(self, request: EngineRequest) -> EngineResult:
        """Transcrit une image locale et retourne une proposition traçable."""
