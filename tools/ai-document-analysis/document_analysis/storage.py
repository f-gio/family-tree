from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .contracts import EngineResult
from .documents import LocalDocument
from .evaluation import NORMALIZATION_ID, measure_transcription


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class LocalStore:
    """SQLite local ; références humaines append-only, sans connexion distante."""

    def __init__(self, database_path: str | Path):
        self.database_path = Path(database_path).expanduser().resolve()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS documents (
                    document_id TEXT PRIMARY KEY, path TEXT NOT NULL, sha256 TEXT NOT NULL UNIQUE,
                    mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
                    width INTEGER NOT NULL, height INTEGER NOT NULL, added_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS runs (
                    run_id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(document_id),
                    engine_id TEXT NOT NULL, model_reference TEXT, configuration_json TEXT NOT NULL,
                    configuration_sha256 TEXT NOT NULL, instructions TEXT NOT NULL,
                    instructions_sha256 TEXT NOT NULL, status TEXT NOT NULL,
                    started_at TEXT NOT NULL, completed_at TEXT, duration_ms INTEGER,
                    cost_eur REAL, cost_status TEXT NOT NULL, error_json TEXT
                );
                CREATE TABLE IF NOT EXISTS proposals (
                    proposal_id TEXT PRIMARY KEY, run_id TEXT NOT NULL UNIQUE REFERENCES runs(run_id),
                    text TEXT NOT NULL, confidence TEXT NOT NULL, provenance_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS references_human (
                    reference_id TEXT PRIMARY KEY, document_id TEXT NOT NULL REFERENCES documents(document_id),
                    revision INTEGER NOT NULL, text TEXT NOT NULL, reviewer TEXT NOT NULL,
                    note TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(document_id, revision)
                );
                CREATE TABLE IF NOT EXISTS evaluations (
                    evaluation_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL REFERENCES proposals(proposal_id),
                    reference_id TEXT NOT NULL REFERENCES references_human(reference_id),
                    cer REAL, wer REAL, status TEXT NOT NULL, normalization_id TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE(proposal_id, reference_id)
                );
            """)
            db.execute(
                """UPDATE runs SET status='interrupted', completed_at=?,
                   error_json=? WHERE status='running'""",
                (utc_now(), json.dumps({"code": "process-restarted", "message": "Exécution interrompue avant sa fin."}, ensure_ascii=False)),
            )

    def register_document(self, document: LocalDocument) -> bool:
        """Inscrit ou retrouve le document à empreinte identique ; ne copie rien."""
        with self._connect() as db:
            existing = db.execute("SELECT document_id FROM documents WHERE sha256 = ?", (document.sha256,)).fetchone()
            if existing:
                return False
            db.execute(
                "INSERT INTO documents VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (document.document_id, str(document.path), document.sha256, document.mime_type,
                 document.size_bytes, document.width, document.height, utc_now()),
            )
            return True

    def list_documents(self) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM documents ORDER BY added_at, path")]

    def get_document(self, document_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute("SELECT * FROM documents WHERE document_id = ?", (document_id,)).fetchone()
            return dict(row) if row else None

    def start_run(self, document_id: str, engine_id: str, configuration: dict[str, Any], instructions: str) -> str:
        run_id = str(uuid.uuid4())
        config_json = json.dumps(configuration, ensure_ascii=False, sort_keys=True)
        import hashlib
        with self._connect() as db:
            db.execute(
                """INSERT INTO runs (run_id, document_id, engine_id, configuration_json,
                   configuration_sha256, instructions, instructions_sha256, status, started_at,
                   cost_status) VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, 'unknown')""",
                (run_id, document_id, engine_id, config_json,
                 hashlib.sha256(config_json.encode("utf-8")).hexdigest(), instructions,
                 hashlib.sha256(instructions.encode("utf-8")).hexdigest(), utc_now()),
            )
        return run_id

    def finish_run(self, run_id: str, result: EngineResult) -> None:
        with self._connect() as db:
            db.execute(
                """UPDATE runs SET status = ?, model_reference = ?, completed_at = ?, duration_ms = ?,
                   cost_eur = ?, cost_status = ?, error_json = ? WHERE run_id = ?""",
                ("failed" if result.errors else "succeeded", result.model_reference, utc_now(),
                 result.duration_ms, result.cost_eur, result.cost_status,
                 json.dumps(result.errors, ensure_ascii=False), run_id),
            )
            if not result.errors:
                db.execute(
                    "INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), run_id, result.text, result.confidence,
                     json.dumps(result.provenance, ensure_ascii=False, sort_keys=True), utc_now()),
                )

    def fail_run(self, run_id: str, error: Exception) -> None:
        with self._connect() as db:
            db.execute(
                "UPDATE runs SET status='failed', completed_at=?, error_json=? WHERE run_id=?",
                (utc_now(), json.dumps({"type": type(error).__name__, "message": str(error)}, ensure_ascii=False), run_id),
            )

    def add_human_reference(self, document_id: str, text: str, reviewer: str, note: str = "") -> str:
        if not reviewer.strip():
            raise ValueError("Le nom ou identifiant du correcteur est requis.")
        with self._connect() as db:
            latest = db.execute(
                "SELECT COALESCE(MAX(revision), 0) AS revision FROM references_human WHERE document_id=?",
                (document_id,),
            ).fetchone()["revision"]
            reference_id = str(uuid.uuid4())
            db.execute(
                "INSERT INTO references_human VALUES (?, ?, ?, ?, ?, ?, ?)",
                (reference_id, document_id, latest + 1, text, reviewer.strip(), note, utc_now()),
            )
            return reference_id

    def latest_reference(self, document_id: str) -> dict[str, Any] | None:
        with self._connect() as db:
            row = db.execute(
                "SELECT * FROM references_human WHERE document_id=? ORDER BY revision DESC LIMIT 1",
                (document_id,),
            ).fetchone()
            return dict(row) if row else None

    def list_references(self, document_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            return [dict(row) for row in db.execute(
                "SELECT * FROM references_human WHERE document_id=? ORDER BY revision", (document_id,)
            )]

    def list_results(self, document_id: str) -> list[dict[str, Any]]:
        with self._connect() as db:
            rows = db.execute(
                """SELECT r.*, p.proposal_id, p.text, p.confidence, p.provenance_json
                   FROM runs r LEFT JOIN proposals p ON p.run_id=r.run_id
                   WHERE r.document_id=? ORDER BY r.started_at DESC""", (document_id,)
            )
            return [dict(row) for row in rows]

    def evaluate_document(self, document_id: str) -> int:
        reference = self.latest_reference(document_id)
        if reference is None:
            return 0
        inserted = 0
        with self._connect() as db:
            proposals = db.execute(
                """SELECT p.proposal_id, p.text FROM proposals p JOIN runs r USING(run_id)
                   WHERE r.document_id=?""", (document_id,)
            ).fetchall()
            for proposal in proposals:
                metrics = measure_transcription(proposal["text"], reference["text"])
                db.execute(
                    """INSERT OR IGNORE INTO evaluations VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                    (str(uuid.uuid4()), proposal["proposal_id"], reference["reference_id"],
                     metrics.cer, metrics.wer, metrics.status, NORMALIZATION_ID, utc_now()),
                )
                inserted += db.execute("SELECT changes()").fetchone()[0]
        return inserted

    def summary(self) -> dict[str, int]:
        with self._connect() as db:
            return {
                "documents": db.execute("SELECT COUNT(*) FROM documents").fetchone()[0],
                "runs": db.execute("SELECT COUNT(*) FROM runs").fetchone()[0],
                "references": db.execute("SELECT COUNT(*) FROM references_human").fetchone()[0],
                "evaluations": db.execute("SELECT COUNT(*) FROM evaluations WHERE status='scored'").fetchone()[0],
                "documents_evaluated": db.execute("SELECT COUNT(DISTINCT r.document_id) FROM evaluations e JOIN proposals p USING(proposal_id) JOIN runs r USING(run_id) WHERE e.status='scored'").fetchone()[0],
            }
