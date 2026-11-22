from __future__ import annotations

from .contracts import EngineRequest
from .documents import inspect_image
from .engines import DEFAULT_INSTRUCTIONS
from .storage import LocalStore


def validate_engine_result(result, expected_engine_id: str) -> None:
    if result.engine_id != expected_engine_id:
        raise ValueError("L’identifiant moteur retourné ne correspond pas à l’adaptateur appelé.")
    if not isinstance(result.text, str):
        raise TypeError("Le texte moteur doit être une chaîne.")
    if not isinstance(result.duration_ms, int) or isinstance(result.duration_ms, bool) or result.duration_ms < 0:
        raise ValueError("La durée moteur doit être un entier positif ou nul.")
    if result.confidence not in {"high", "medium", "low", "unknown"}:
        raise ValueError("La confiance doit être high, medium, low ou unknown.")
    if result.cost_status not in {"known", "unknown", "not-applicable"}:
        raise ValueError("État de coût non reconnu.")
    if result.cost_status == "known":
        if not isinstance(result.cost_eur, (int, float)) or isinstance(result.cost_eur, bool) or result.cost_eur < 0:
            raise ValueError("Un coût connu doit être un nombre positif ou nul.")
    elif result.cost_eur is not None:
        raise ValueError("Un coût inconnu ou non applicable doit rester nul (None).")
    if not isinstance(result.provenance, dict):
        raise TypeError("La provenance moteur doit être un objet/dictionnaire.")
    if not isinstance(result.errors, tuple) or any(not isinstance(item, dict) for item in result.errors):
        raise TypeError("Les erreurs moteur doivent être un tuple d’objets structurés.")


def run_engine(
    store: LocalStore,
    document_id: str,
    engine,
    configuration: dict,
    instructions: str = DEFAULT_INSTRUCTIONS,
    maximum_image_bytes: int = 50 * 1024 * 1024,
):
    document = store.get_document(document_id)
    if document is None:
        raise KeyError(f"Document inconnu : {document_id}")
    run_id = store.start_run(document_id, engine.engine_id, configuration, instructions)
    try:
        inspected = inspect_image(document["path"], maximum_bytes=maximum_image_bytes)
        if inspected.sha256 != document["sha256"]:
            raise ValueError("L’image a changé depuis son import ; réimportez-la pour préserver la traçabilité.")
        result = engine.transcribe(EngineRequest(
            image_path=inspected.path,
            document_id=document_id,
            run_id=run_id,
            configuration=configuration,
            instructions=instructions,
        ))
        validate_engine_result(result, engine.engine_id)
        store.finish_run(run_id, result)
        return run_id, result
    except Exception as error:
        store.fail_run(run_id, error)
        raise
