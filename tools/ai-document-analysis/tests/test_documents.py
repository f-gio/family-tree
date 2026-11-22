from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from PIL import Image

from document_analysis.documents import DocumentLoadError, inspect_image


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)

    def make_image(self, name="registro è.png", image_format="PNG"):
        path = self.folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGB", (23, 17), color=(235, 220, 190)).save(path, format=image_format)
        return path

    def test_identifie_jpeg_et_png_unicode_sans_modifier_l_original(self):
        for filename, image_format, mime in [
            ("registro è.png", "PNG", "image/png"),
            ("atto-é.jpg", "JPEG", "image/jpeg"),
        ]:
            path = self.make_image(filename, image_format)
            before = path.read_bytes()
            document = inspect_image(path)
            self.assertEqual(document.path, path.resolve())
            self.assertEqual(document.mime_type, mime)
            self.assertEqual((document.width, document.height), (23, 17))
            self.assertEqual(document.document_id, f"sha256:{document.sha256}")
            self.assertEqual(path.read_bytes(), before)

    def test_rejette_fichier_absent_extension_non_valide_corruption_et_taille(self):
        with self.assertRaises(DocumentLoadError):
            inspect_image(self.folder / "absent.png")
        unsupported = self.folder / "notes.txt"
        unsupported.write_text("texte", encoding="utf-8")
        with self.assertRaises(DocumentLoadError):
            inspect_image(unsupported)
        corrupt = self.folder / "rotta.png"
        corrupt.write_bytes(b"not an image")
        with self.assertRaises(DocumentLoadError):
            inspect_image(corrupt)
        good = self.make_image("grande.png")
        with self.assertRaises(DocumentLoadError):
            inspect_image(good, maximum_bytes=1)

    def test_extension_majuscule_et_chemin_unicode_acceptes(self):
        path = self.make_image("Cartella è\\prova.PNG")
        # Le barre inverse in un nome sono separatori su Windows ; il percorso
        # prodotto da pathlib resta utilisable par l’appelant.
        self.assertEqual(inspect_image(path).mime_type, "image/png")


if __name__ == "__main__":
    unittest.main()
