from __future__ import annotations

import json
import io
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image

from document_analysis import app

ROOT = Path(__file__).resolve().parents[1]


class CliWorkflowTests(unittest.TestCase):
    def test_flux_local_complet_import_fixture_reference_evaluation_resume(self):
        with tempfile.TemporaryDirectory() as folder:
            private = Path(folder)
            image = private / "registro è.png"
            Image.new("RGB", (12, 15), "white").save(image)
            environment = os.environ.copy()
            environment["DOCUMENT_ANALYSIS_DATA_DIR"] = str(private / "data")
            environment["DOCUMENT_ANALYSIS_CONFIG"] = str(ROOT / "config.example.json")

            def invoke(*arguments):
                return subprocess.run(
                    [sys.executable, str(ROOT / "run.py"), *arguments],
                    cwd=ROOT,
                    env=environment,
                    text=True,
                    capture_output=True,
                    check=False,
                )

            imported = invoke("import", str(image))
            self.assertEqual(imported.returncode, 0, imported.stderr)
            self.assertIn("1", imported.stdout)

            listed = invoke("list")
            self.assertEqual(listed.returncode, 0, listed.stderr)
            document_id = listed.stdout.split("\t", 1)[0]
            self.assertTrue(document_id.startswith("sha256:"))

            proposal = invoke("run-fixture", document_id, "--text", "Giovanni Bianchi")
            self.assertEqual(proposal.returncode, 0, proposal.stderr)
            self.assertIn("non IA", proposal.stdout)
            self.assertIn("Giovanni Bianchi", proposal.stdout)

            reference = invoke("reference", document_id, "--reviewer", "lectrice", "--text", "Giovanni Bianchi")
            self.assertEqual(reference.returncode, 0, reference.stderr)
            self.assertIn("nouvelle révision append-only", reference.stdout)

            evaluated = invoke("evaluate", document_id)
            self.assertEqual(evaluated.returncode, 0, evaluated.stderr)
            self.assertIn("CER 0.0000", evaluated.stdout)
            self.assertIn("WER 0.0000", evaluated.stdout)

            summary = invoke("summary")
            self.assertEqual(summary.returncode, 0, summary.stderr)
            counts = json.loads(summary.stdout)
            self.assertEqual(counts["documents"], 1)
            self.assertEqual(counts["runs"], 1)
            self.assertEqual(counts["references"], 1)
            self.assertEqual(counts["evaluations"], 1)
            self.assertEqual(counts["documents_evaluated"], 1)

    def test_commande_florence_affiche_une_proposition_et_les_durees(self):
        fake_result = SimpleNamespace(
            model_load_ms=1450, duration_ms=98700, text="OCR local de démonstration",
        )
        output = io.StringIO()
        with patch.object(sys, "argv", ["run.py", "run-florence", "sha256:synthetique"]), \
             patch("document_analysis.app.store", return_value=object()), \
             patch("document_analysis.app.available_engines", return_value={"florence-2-base": object()}), \
             patch("document_analysis.app.run_engine", return_value=("run-factice-test", fake_result)) as run:
            with redirect_stdout(output):
                self.assertEqual(app.run_cli(), 0)
        self.assertEqual(run.call_args.args[1], "sha256:synthetique")
        self.assertIn("Florence-2-base en CPU", output.getvalue())
        self.assertIn("1450 ms", output.getvalue())
        self.assertIn("98700 ms", output.getvalue())
        self.assertIn("OCR local de démonstration", output.getvalue())


if __name__ == "__main__":
    unittest.main()
