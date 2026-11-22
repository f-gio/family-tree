import json
import tempfile
import unittest
from pathlib import Path

from document_analysis.settings import load_config


class SettingsTests(unittest.TestCase):
    def test_charge_configuration_locale_et_refuse_appels_externes(self):
        with tempfile.TemporaryDirectory() as folder:
            config_path = Path(folder) / "config.json"
            config_path.write_text(json.dumps({
                "data_dir": ".local-data",
                "maximum_image_bytes": 1024,
                "budget_monthly_eur": 3.0,
                "external_calls_enabled": False,
            }), encoding="utf-8")
            self.assertEqual(load_config(config_path)["maximum_image_bytes"], 1024)
            config_path.write_text(json.dumps({
                "data_dir": ".local-data",
                "maximum_image_bytes": 1024,
                "budget_monthly_eur": 3.0,
                "external_calls_enabled": True,
            }), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "désactivés"):
                load_config(config_path)

    def test_absence_de_configuration_utilise_l_exemple_versionne(self):
        with tempfile.TemporaryDirectory() as folder:
            config = load_config(Path(folder) / "absente.json")
        self.assertFalse(config["external_calls_enabled"])
        self.assertEqual(config["budget_monthly_eur"], 3.0)


if __name__ == "__main__":
    unittest.main()
