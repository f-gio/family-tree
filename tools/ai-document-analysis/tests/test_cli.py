from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


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


if __name__ == "__main__":
    unittest.main()
