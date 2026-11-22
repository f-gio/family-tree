"""Inférence réelle séparée des tests unitaires sans modèle téléchargé."""

from __future__ import annotations

import os
import json
import socket
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw, ImageFont

from document_analysis import app
from document_analysis.documents import inspect_image
from document_analysis.florence_engine import MODEL_FILES, MODEL_REVISION
from document_analysis.storage import LocalStore


@unittest.skipUnless(os.environ.get("FLORENCE_RUN_INTEGRATION") == "1", "définir FLORENCE_RUN_INTEGRATION=1 pour l’inférence réelle")
class FlorenceRealInferenceTests(unittest.TestCase):
    def test_reconnait_une_image_synthetique_en_cpu_sans_reseau_et_persiste_la_proposition(self):
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        with tempfile.TemporaryDirectory(prefix="florence-real-test-") as folder:
            private = Path(folder)
            image_path = private / "atto-sintetico.png"
            image = Image.new("RGB", (1200, 360), "white")
            draw = ImageDraw.Draw(image)
            font = ImageFont.load_default(size=42)
            draw.text((40, 45), "ATTO DI NASCITA", fill="black", font=font)
            draw.text((40, 145), "Giovanni Bianchi - 1902", fill="black", font=font)
            image.save(image_path)

            database_path = private / "private" / "integration.sqlite3"
            store = LocalStore(database_path)
            document = inspect_image(image_path)
            store.register_document(document)
            previous_database = app.DATABASE
            app.DATABASE = database_path
            output = StringIO()

            def reject_network(*_args, **_kwargs):
                raise AssertionError("L’inférence locale ne doit ouvrir aucun socket.")

            try:
                with patch.object(socket.socket, "connect", reject_network), \
                     patch.object(socket, "create_connection", reject_network), \
                     patch.object(sys, "argv", ["run.py", "run-florence", document.document_id, "--max-new-tokens", "128"]), \
                     redirect_stdout(output):
                    self.assertEqual(app.run_cli(), 0)
            finally:
                app.DATABASE = previous_database

            store = LocalStore(database_path)
            stored = store.list_results(document.document_id)[0]
            provenance = json.loads(stored["provenance_json"])
            self.assertEqual((stored["engine_id"], stored["status"]), ("florence-2-base", "succeeded"))
            self.assertIn(MODEL_REVISION, stored["model_reference"])
            self.assertIn("Florence-2-base en CPU", output.getvalue())
            self.assertIn("ATTO DI NASCITA", stored["text"])
            self.assertIn("Giovanni Bianchi", stored["text"])
            self.assertEqual(stored["confidence"], "unknown")
            self.assertEqual((stored["cost_eur"], stored["cost_status"]), (0.0, "known"))
            self.assertGreater(stored["model_load_ms"], 0)
            self.assertGreater(stored["duration_ms"], 0)
            self.assertEqual(provenance["local_files_only"], True)
            self.assertEqual(provenance["model_file_sha256"], MODEL_FILES["model.safetensors"][1])
            self.assertGreater(provenance["generation_ms"], 0)
            self.assertGreater(provenance["process_rss_mib_after_inference"], 0)
            self.assertTrue(provenance["raw_model_output"].strip())
            self.assertIsNone(store.latest_reference(document.document_id))
            self.assertEqual(store.evaluate_document(document.document_id), 0)
            print({
                "model": stored["model_reference"],
                "load_ms": stored["model_load_ms"],
                "total_transcription_ms": stored["duration_ms"],
                "preprocessing_ms": provenance["preprocessing_ms"],
                "generation_ms": provenance["generation_ms"],
                "system_ram_available_mib_before_load": provenance["ram_available_mib_before_model_load"],
                "system_ram_available_mib_after_load": provenance["ram_available_mib_after_model_load"],
                "system_ram_available_mib_after_inference": provenance["ram_available_mib_after_inference"],
                "process_rss_mib_after_load": provenance["process_rss_mib_after_model_load"],
                "process_rss_mib_after_inference": provenance["process_rss_mib_after_inference"],
                "synthetic_raw_output": provenance["raw_model_output"],
                "synthetic_ocr": stored["text"],
                "cer_wer": "non calculés : pas de référence humaine",
            })


if __name__ == "__main__":
    unittest.main()
