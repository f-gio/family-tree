from __future__ import annotations

import unicodedata
from dataclasses import dataclass

NORMALIZATION_ID = "unicode-nfc-whitespace-v1"


@dataclass(frozen=True)
class TextMetrics:
    cer: float | None
    wer: float | None
    status: str
    reference_characters: int
    reference_words: int


def normalize_for_scoring(text: str) -> str:
    """NFC + espaces consécutifs seulement ; accents/ponctuation restent."""
    return " ".join(unicodedata.normalize("NFC", text).split())


def edit_distance(left: str, right: str) -> int:
    """Distance de Levenshtein à mémoire O(min(n,m))."""
    if len(left) < len(right):
        left, right = right, left
    previous = list(range(len(right) + 1))
    for row, left_char in enumerate(left, start=1):
        current = [row]
        for column, right_char in enumerate(right, start=1):
            current.append(min(
                current[-1] + 1,
                previous[column] + 1,
                previous[column - 1] + (left_char != right_char),
            ))
        previous = current
    return previous[-1]


def measure_transcription(prediction: str, reference: str | None) -> TextMetrics:
    if reference is None:
        return TextMetrics(None, None, "reference-missing", 0, 0)
    normalized_reference = normalize_for_scoring(reference)
    normalized_prediction = normalize_for_scoring(prediction)
    reference_words = normalized_reference.split() if normalized_reference else []
    prediction_words = normalized_prediction.split() if normalized_prediction else []
    if not normalized_reference:
        return TextMetrics(None, None, "reference-empty", 0, 0)
    reference_characters = len(normalized_reference)
    return TextMetrics(
        cer=edit_distance(normalized_prediction, normalized_reference) / reference_characters,
        wer=edit_distance(prediction_words, reference_words) / len(reference_words),
        status="scored",
        reference_characters=reference_characters,
        reference_words=len(reference_words),
    )
