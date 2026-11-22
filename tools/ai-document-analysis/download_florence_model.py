"""Télécharge explicitement et vérifie le snapshot Florence-2-base épinglé.

Cette commande est le seul chemin de téléchargement du prototype. L’interface
et le moteur d’inférence ne téléchargent jamais de modèle automatiquement.
"""

from __future__ import annotations

from hashlib import sha256
import sys

from document_analysis.florence_engine import DEFAULT_MODEL_DIR, MODEL_FILES, MODEL_ID, MODEL_REVISION, verify_model_files


def main() -> int:
    target = DEFAULT_MODEL_DIR
    existing = [target / name for name in MODEL_FILES if (target / name).exists()]
    for path in existing:
        expected_size, expected_hash = MODEL_FILES[path.name]
        if path.stat().st_size != expected_size:
            print(f"Refus d’écraser un fichier préexistant de taille différente : {path}", file=sys.stderr)
            return 2
        digest = sha256()
        with path.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        if digest.hexdigest() != expected_hash:
            print(f"Refus d’écraser un fichier préexistant dont le SHA-256 diffère : {path}", file=sys.stderr)
            return 2

    try:
        verify_model_files(target)
        print(f"Snapshot déjà présent et vérifié : {MODEL_ID}@{MODEL_REVISION}")
        return 0
    except FileNotFoundError:
        pass
    except ValueError as error:
        print(f"Snapshot local incohérent ; aucun fichier n’est remplacé : {error}", file=sys.stderr)
        return 2

    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        print(f"Dépendance de téléchargement manquante dans le venv Florence : {error}", file=sys.stderr)
        return 2

    target.mkdir(parents=True, exist_ok=True)
    snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        local_dir=target,
        allow_patterns=sorted(MODEL_FILES),
        token=False,
        local_files_only=False,
        max_workers=2,
    )
    try:
        verify_model_files(target)
    except (OSError, ValueError) as error:
        print(f"Vérification du snapshot échouée : {error}", file=sys.stderr)
        return 1
    print(f"Snapshot téléchargé et vérifié : {MODEL_ID}@{MODEL_REVISION} → {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
