from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_config(config_path: str | Path) -> dict[str, Any]:
    path = Path(config_path)
    if not path.exists():
        path = Path(__file__).resolve().parents[1] / "config.example.json"
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Configuration locale illisible : {path}") from error
    maximum_bytes = config.get("maximum_image_bytes")
    budget = config.get("budget_monthly_eur")
    if not isinstance(maximum_bytes, int) or isinstance(maximum_bytes, bool) or maximum_bytes < 1:
        raise ValueError("maximum_image_bytes doit être un entier strictement positif.")
    if not isinstance(budget, (int, float)) or isinstance(budget, bool) or budget < 0:
        raise ValueError("budget_monthly_eur doit être un nombre positif ou nul.")
    if config.get("external_calls_enabled") is not False:
        raise ValueError("Les appels externes sont désactivés dans le prototype local.")
    if not isinstance(config.get("data_dir"), str) or not config["data_dir"].strip():
        raise ValueError("data_dir doit être un chemin relatif ou absolu non vide.")
    return config
