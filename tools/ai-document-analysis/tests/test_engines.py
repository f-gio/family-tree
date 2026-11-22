import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from document_analysis.contracts import EngineRequest
from document_analysis.engines import FixtureTextEngine
from document_analysis.runner import validate_engine_result


class FixtureEngineTests(unittest.TestCase):
    def test_fixture_est_deterministe_et_explicitement_non_ia(self):
        with tempfile.TemporaryDirectory() as folder:
            request = EngineRequest(Path(folder) / "image.png", "sha256:test", "run-1", {"text": "Giovanni Bianchi"}, "instructions")
            engine = FixtureTextEngine()
            first = engine.transcribe(request)
            second = engine.transcribe(request)
        self.assertEqual(first.text, "Giovanni Bianchi")
        self.assertEqual(first.engine_id, "fixture-text")
        self.assertEqual(first.model_reference, "fixture-text-v1 (aucune IA ; texte fourni par l’opérateur)")
        self.assertEqual(first.cost_status, "known")
        self.assertEqual(first.cost_eur, 0.0)
        self.assertEqual(first.confidence, "unknown")
        self.assertEqual(first.provenance["image_read_by_engine"], False)
        self.assertEqual(first.text, second.text)
        self.assertEqual(first.provenance["instructions_sha256"], second.provenance["instructions_sha256"])

    def test_fixture_refuse_un_texte_non_textuel(self):
        request = EngineRequest(Path("not-used.png"), "doc", "run", {"text": 42}, "instructions")
        with self.assertRaises(TypeError):
            FixtureTextEngine().transcribe(request)

    def test_contrat_refuse_un_cout_inconnu_presenté_comme_zero(self):
        result = SimpleNamespace(
            engine_id="candidate", text="lecture", duration_ms=1, cost_status="unknown",
            cost_eur=0, confidence="unknown", model_load_ms=0, provenance={}, errors=(),
        )
        with self.assertRaisesRegex(ValueError, "doit rester nul"):
            validate_engine_result(result, "candidate")


if __name__ == "__main__":
    unittest.main()
