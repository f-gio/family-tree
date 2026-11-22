from __future__ import annotations

import hashlib
import os
import threading
import time
from pathlib import Path

from .contracts import EngineRequest, EngineResult

MODEL_ID = "microsoft/Florence-2-base"
MODEL_REVISION = "5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac"
MODEL_FILES = {
    "LICENSE": (1141, "c2cfccb812fe482101a8f04597dfc5a9991a6b2748266c47ac91b6a5aae15383"),
    "config.json": (2430, "c666d0fe0172d46e115e8fba6cd93cd83714575b33a73005cab8d24ce2a3aa8f"),
    "configuration_florence2.py": (15119, "de2e45a975b3582de05d2f4d963a3e9f9a3d20dccf78d28e0052932a0be93bdf"),
    "modeling_florence2.py": (127455, "5162bf465e61b6e29cc113a467630ec3cb56ed8e4d46eb6207157f10fb9b8a24"),
    "model.safetensors": (463221266, "03075d2d2d2bbd3e180b9ba0afae4aa8563226e2d32911656966e05b2f2ee060"),
    "preprocessor_config.json": (806, "2f5921bbc53c7cc04251e1027b45b1cec726276be6db23d1bb40641bfbe2cf29"),
    "processing_florence2.py": (48676, "f146023a507c009f425a49ee39aa037f4f25c64e14336e3e4f3f1d7377a68e98"),
    "tokenizer.json": (1355863, "847bbeab6174d66a88898f729d52fa8d355fafe1bea101cf960dd404581df70e"),
    "tokenizer_config.json": (34, "79ffcf43af8ebda99d165f61d243180da2e2639952e41e71e11611c18770489c"),
    "vocab.json": (1099884, "394fdc63c71aabe0a9b97117f5d62fb5fcc4d59b2b3ea929a3929e6a53217b3c"),
}
DEFAULT_MODEL_DIR = (
    Path(__file__).resolve().parents[1]
    / "model-cache"
    / "florence-2-base"
    / MODEL_REVISION
)
MINIMUM_FREE_RAM_BYTES = 1024 * 1024 * 1024


def verify_model_files(model_dir: str | Path) -> None:
    """Vérifie tous les fichiers officiels du snapshot par taille et SHA-256."""
    root = Path(model_dir).expanduser().resolve()
    for name, (expected_size, expected_sha256) in MODEL_FILES.items():
        path = root / name
        if not path.is_file():
            raise FileNotFoundError(
                f"Fichier Florence absent : {path}. Exécutez d’abord download_florence_model.py."
            )
        if path.stat().st_size != expected_size:
            raise ValueError(f"Taille inattendue pour le fichier Florence : {name}.")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != expected_sha256:
            raise ValueError(f"SHA-256 inattendu pour le fichier Florence : {name}.")


def available_ram_bytes() -> int:
    """Retourne la mémoire physique disponible sous Windows sans dépendance ML."""
    import ctypes
    from ctypes import wintypes

    class MemoryStatusEx(ctypes.Structure):
        _fields_ = [
            ("dwLength", wintypes.DWORD),
            ("dwMemoryLoad", wintypes.DWORD),
            ("ullTotalPhys", ctypes.c_ulonglong),
            ("ullAvailPhys", ctypes.c_ulonglong),
            ("ullTotalPageFile", ctypes.c_ulonglong),
            ("ullAvailPageFile", ctypes.c_ulonglong),
            ("ullTotalVirtual", ctypes.c_ulonglong),
            ("ullAvailVirtual", ctypes.c_ulonglong),
            ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
        ]

    status = MemoryStatusEx()
    status.dwLength = ctypes.sizeof(status)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
        raise OSError("Windows n’a pas fourni l’état de mémoire disponible.")
    return int(status.ullAvailPhys)


class Florence2Engine:
    """Adaptateur Florence OCR local, CPU seulement et fichiers révisionnés."""

    engine_id = "florence-2-base"

    def __init__(self, model_dir: str | Path | None = None):
        self.model_dir = Path(DEFAULT_MODEL_DIR if model_dir is None else model_dir).expanduser().resolve()
        self._processor = None
        self._model = None
        self._torch = None
        self._psutil = None
        self._model_load_ms = 0
        self._load_lock = threading.Lock()
        self._ram_before_load = None
        self._ram_after_load = None
        self._rss_after_load = None

    def _load_model(self) -> int:
        if self._model is not None:
            return 0
        with self._load_lock:
            if self._model is not None:
                return 0

            verify_model_files(self.model_dir)
            free_before = available_ram_bytes()
            if free_before < MINIMUM_FREE_RAM_BYTES:
                raise RuntimeError(
                    f"RAM disponible insuffisante ({free_before // (1024 * 1024)} Mio ; "
                    f"minimum prudent {MINIMUM_FREE_RAM_BYTES // (1024 * 1024)} Mio). "
                    "Fermez d’autres applications puis réessayez."
                )

            try:
                import torch
                import psutil
                from transformers import AutoModelForCausalLM, AutoProcessor
            except ImportError as error:
                raise RuntimeError(
                    "Dépendances Florence absentes. Utilisez .venv-florence et requirements-florence.txt."
                ) from error

            # Local-only and pinned directory: no weight/code lookup is allowed at inference.
            os.environ["HF_HUB_OFFLINE"] = "1"
            os.environ["TRANSFORMERS_OFFLINE"] = "1"
            torch.set_num_threads(min(4, os.cpu_count() or 1))
            started = time.perf_counter()
            self._processor = AutoProcessor.from_pretrained(
                self.model_dir,
                local_files_only=True,
                trust_remote_code=True,
            )
            self._model = AutoModelForCausalLM.from_pretrained(
                self.model_dir,
                local_files_only=True,
                trust_remote_code=True,
                use_safetensors=True,
                torch_dtype=torch.float16,
                low_cpu_mem_usage=True,
            ).to("cpu")
            self._model.eval()
            self._torch = torch
            self._psutil = psutil
            self._model_load_ms = round((time.perf_counter() - started) * 1000)
            self._ram_before_load = free_before
            self._ram_after_load = available_ram_bytes()
            self._rss_after_load = psutil.Process().memory_info().rss
            return self._model_load_ms

    def transcribe(self, request: EngineRequest) -> EngineResult:
        max_new_tokens = request.configuration.get("max_new_tokens", 512)
        if not isinstance(max_new_tokens, int) or isinstance(max_new_tokens, bool) or not 1 <= max_new_tokens <= 1024:
            raise ValueError("max_new_tokens doit être un entier compris entre 1 et 1024.")

        model_load_ms = self._load_model()
        from PIL import Image

        try:
            with Image.open(request.image_path) as source:
                image = source.convert("RGB")
        except (OSError, ValueError) as error:
            raise ValueError(f"Image illisible pour Florence-2 : {request.image_path}") from error

        total_started = time.perf_counter()
        inputs = self._processor(text="<OCR>", images=image, return_tensors="pt")
        preprocessing_ms = round((time.perf_counter() - total_started) * 1000)
        inputs["pixel_values"] = inputs["pixel_values"].to(
            device="cpu", dtype=next(self._model.parameters()).dtype
        )
        generation_started = time.perf_counter()
        with self._torch.inference_mode():
            generated = self._model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                num_beams=1,
                early_stopping=False,
                do_sample=False,
            )
        generation_ms = round((time.perf_counter() - generation_started) * 1000)
        raw_output = self._processor.batch_decode(generated, skip_special_tokens=False)[0]
        transcription = self._processor.post_process_generation(
            raw_output, task="<OCR>", image_size=image.size
        )["<OCR>"]
        duration_ms = round((time.perf_counter() - total_started) * 1000)
        ram_after_inference = available_ram_bytes()
        rss_after_inference = self._psutil.Process().memory_info().rss

        return EngineResult(
            engine_id=self.engine_id,
            model_reference=f"{MODEL_ID}@{MODEL_REVISION}",
            text=transcription,
            duration_ms=duration_ms,
            model_load_ms=model_load_ms,
            cost_eur=0.0,
            cost_status="known",
            confidence="unknown",
            provenance={
                "kind": "local-model-inference",
                "model_id": MODEL_ID,
                "model_revision": MODEL_REVISION,
                "model_file_sha256": MODEL_FILES["model.safetensors"][1],
                "task_prompt": "<OCR>",
                "device": "cpu",
                "dtype": str(next(self._model.parameters()).dtype),
                "preprocessing_ms": preprocessing_ms,
                "generation_ms": generation_ms,
                "ram_available_mib_before_model_load": round((self._ram_before_load or 0) / 1048576, 1),
                "ram_available_mib_after_model_load": round((self._ram_after_load or 0) / 1048576, 1),
                "ram_available_mib_after_inference": round(ram_after_inference / 1048576, 1),
                "process_rss_mib_after_model_load": round((self._rss_after_load or 0) / 1048576, 1),
                "process_rss_mib_after_inference": round(rss_after_inference / 1048576, 1),
                "raw_model_output": raw_output,
                "input_document_id": request.document_id,
                "run_id": request.run_id,
                "configuration_sha256": hashlib.sha256(
                    str(sorted(request.configuration.items())).encode("utf-8")
                ).hexdigest(),
                "instructions_sha256": hashlib.sha256(request.instructions.encode("utf-8")).hexdigest(),
                "local_files_only": True,
                "trust_remote_code": True,
            },
        )
