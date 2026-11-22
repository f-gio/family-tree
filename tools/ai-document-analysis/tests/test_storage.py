from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from document_analysis.documents import inspect_image
from document_analysis.engines import FixtureTextEngine
from document_analysis.runner import run_engine
from document_analysis.storage import LocalStore


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.image_path = self.root / "immagine è.png"
        Image.new("RGB", (8, 9), "white").save(self.image_path)
        self.store = LocalStore(self.root / "private" / "benchmark.sqlite3")
        self.document = inspect_image(self.image_path)
        self.assertTrue(self.store.register_document(self.document))

    def test_persiste_proposition_et_retrouve_sans_nouvelle_execution(self):
        run_id, _ = run_engine(self.store, self.document.document_id, FixtureTextEngine(), {"text": "Rossi"})
        self.assertFalse(self.store.register_document(inspect_image(self.image_path)))
        rows = self.store.list_results(self.document.document_id)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["run_id"], run_id)
        self.assertEqual(rows[0]["text"], "Rossi")
        self.assertEqual(len(rows[0]["configuration_sha256"]), 64)

    def test_reference_humaine_est_append_only_et_les_scores_sont_lies_a_son_id(self):
        run_id, _ = run_engine(self.store, self.document.document_id, FixtureTextEngine(), {"text": "Rossi"})
        first_id = self.store.add_human_reference(self.document.document_id, "Rossi", "lectrice")
        second_id = self.store.add_human_reference(self.document.document_id, "Rossi,", "lectrice", "Ponctuation vérifiée")
        references = self.store.list_references(self.document.document_id)
        self.assertEqual([item["revision"] for item in references], [1, 2])
        self.assertEqual(references[0]["reference_id"], first_id)
        self.assertEqual(references[1]["reference_id"], second_id)
        self.assertEqual(self.store.latest_reference(self.document.document_id)["text"], "Rossi,")
        self.assertEqual(self.store.evaluate_document(self.document.document_id), 1)
        self.assertEqual(self.store.evaluate_document(self.document.document_id), 0)
        with self.store._connect() as db:
            evaluation = db.execute("SELECT * FROM evaluations").fetchone()
        self.assertEqual(evaluation["reference_id"], second_id)
        self.assertEqual(evaluation["status"], "scored")
        self.assertEqual(evaluation["normalization_id"], "unicode-nfc-whitespace-v1")
        self.assertEqual(self.store.summary(), {"documents": 1, "runs": 1, "references": 2, "evaluations": 1, "documents_evaluated": 1})

    def test_erreur_moteur_est_stockee_sans_creer_de_proposition(self):
        class BrokenEngine:
            engine_id = "broken-test"

            def transcribe(self, request):
                raise RuntimeError("erreur de fixture")

        with self.assertRaisesRegex(RuntimeError, "erreur de fixture"):
            run_engine(self.store, self.document.document_id, BrokenEngine(), {})
        result = self.store.list_results(self.document.document_id)[0]
        self.assertEqual(result["status"], "failed")
        self.assertIsNone(result["proposal_id"])
        self.assertIn("erreur de fixture", result["error_json"])

    def test_fichier_modifie_depuis_import_est_refuse(self):
        Image.new("RGB", (8, 9), "red").save(self.image_path)
        with self.assertRaisesRegex(ValueError, "a changé depuis son import"):
            run_engine(self.store, self.document.document_id, FixtureTextEngine(), {"text": "ne pas enregistrer"})
        self.assertEqual(self.store.summary()["runs"], 1)
        self.assertEqual(self.store.list_results(self.document.document_id)[0]["status"], "failed")

    def test_reference_sans_auteur_est_refusee(self):
        with self.assertRaises(ValueError):
            self.store.add_human_reference(self.document.document_id, "texte", " ")

    def test_execution_laisee_en_cours_est_marquee_interrompue_au_redemarrage(self):
        run_id = self.store.start_run(self.document.document_id, "engine-test", {}, "prompt")
        reopened = LocalStore(self.store.database_path)
        self.assertEqual(reopened.list_results(self.document.document_id)[0]["status"], "interrupted")
        self.assertEqual(reopened.list_results(self.document.document_id)[0]["run_id"], run_id)


if __name__ == "__main__":
    unittest.main()
