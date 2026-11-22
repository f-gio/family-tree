from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png"}
SUPPORTED_FORMATS = {"JPEG", "PNG"}
DEFAULT_MAXIMUM_IMAGE_BYTES = 50 * 1024 * 1024
DEFAULT_MAXIMUM_PIXELS = 120_000_000


class DocumentLoadError(ValueError):
    """Fichier absent, non pris en charge, trop volumineux ou invalide."""


@dataclass(frozen=True)
class LocalDocument:
    document_id: str
    path: Path
    sha256: str
    mime_type: str
    size_bytes: int
    width: int
    height: int


def inspect_image(
    path: str | Path,
    maximum_bytes: int = DEFAULT_MAXIMUM_IMAGE_BYTES,
    maximum_pixels: int = DEFAULT_MAXIMUM_PIXELS,
) -> LocalDocument:
    """Valide et identifie une image locale sans la copier ni la modifier."""
    image_path = Path(path).expanduser()
    try:
        resolved = image_path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise DocumentLoadError(f"Fichier introuvable ou inaccessible : {image_path}") from error
    if not resolved.is_file():
        raise DocumentLoadError(f"Le chemin n’est pas un fichier : {resolved}")
    if resolved.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise DocumentLoadError(f"Extension non prise en charge : {resolved.suffix or '(aucune)'}")
    try:
        size_bytes = resolved.stat().st_size
        if size_bytes <= 0:
            raise DocumentLoadError("Le fichier est vide.")
        if size_bytes > maximum_bytes:
            raise DocumentLoadError(f"Le fichier dépasse la limite locale de {maximum_bytes} octets.")
        digest = hashlib.sha256()
        with resolved.open("rb") as source:
            for block in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(block)
        with Image.open(resolved) as image:
            image_format = image.format
            width, height = image.size
            if width <= 0 or height <= 0 or width * height > maximum_pixels:
                raise DocumentLoadError(f"Dimensions image non prises en charge (limite : {maximum_pixels} pixels).")
            image.verify()
    except DocumentLoadError:
        raise
    except (OSError, UnidentifiedImageError, Image.DecompressionBombError, ValueError) as error:
        raise DocumentLoadError(f"Image invalide ou illisible : {resolved}") from error
    if image_format not in SUPPORTED_FORMATS:
        raise DocumentLoadError(f"Format image non pris en charge : {image_format or 'inconnu'}")
    mime_type = "image/jpeg" if image_format == "JPEG" else "image/png"
    return LocalDocument(
        document_id=f"sha256:{digest.hexdigest()}",
        path=resolved,
        sha256=digest.hexdigest(),
        mime_type=mime_type,
        size_bytes=size_bytes,
        width=width,
        height=height,
    )
