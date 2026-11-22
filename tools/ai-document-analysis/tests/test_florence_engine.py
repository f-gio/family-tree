import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from document_analysis.contracts import EngineRequest
from document_analysis.engines import available_engines
from document_analysis.florence_engine import (
    DEFAULT_MODEL_DIR,
    MODEL_FILES,
    MODEL_ID,
    MODEL_REVISION,
    Florence2Engine,
    verify_model_files,
)


class FlorenceAdapterUnitTests(unittest.TestCase):
    def test_moteur_est_expose_sans_chargement_automatique_du_modele(self):
        engines = available_engines()
        self.assertIn("fixture-text", engines)
        self.assertIn("florence-2-base", engines)
        engine = engines["florence-2-base"]
        self.assertIsInstance(engine, Florence2Engine)
        self.assertIsNone(engine._model)

    def test_modele_et_revision_sont_epingles(self):
        engine = Florence2Engine()
        self.assertEqual(engine.engine_id, "florence-2-base")
        self.assertEqual(MODEL_ID, "microsoft/Florence-2-base")
        self.assertEqual(MODEL_REVISION, "5ca5edf5bd017b9919c05d08aebef5e4c7ac3bac")
        self.assertEqual(engine.model_dir, DEFAULT_MODEL_DIR.resolve())

    def test_manifest_pin_taille_et_sha_du_checkpoint_officiel(self):
        self.assertEqual(
            MODEL_FILES["model.safetensors"],
            (463221266, "03075d2d2d2bbd3e180b9ba0afae4aa8563226e2d32911656966e05b2f2ee060"),
        )
        self.assertIn("modeling_florence2.py", MODEL_FILES)
        self.assertIn("processing_florence2.py", MODEL_FILES)

    def test_cache_incomplet_est_refuse_sans_essai_de_recuperation(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(FileNotFoundError, "download_florence_model.py"):
                verify_model_files(Path(folder))

    def test_configuration_invalide_est_refusee_sans_charger_le_modele(self):
        engine = Florence2Engine()
        request = EngineRequest(
            image_path=Path("image-inutilisee.png"),
            document_id="document-test",
            run_id="run-test",
            configuration={"max_new_tokens": 0},
            instructions="instructions de test",
        )
        with patch.object(engine, "_load_model", side_effect=AssertionError("chargement inattendu")):
            with self.assertRaisesRegex(ValueError, "compris entre 1 et 1024"):
                engine.transcribe(request)


if __name__ == "__main__":
    unittest.main()
