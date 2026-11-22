from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import tkinter as tk
from PIL import Image

from document_analysis import app
from document_analysis.storage import LocalStore


class LocalUiSmokeTests(unittest.TestCase):
    def test_creation_fenetre_import_fixture_reference_et_affichage_scores(self):
        with tempfile.TemporaryDirectory() as folder:
            root_folder = Path(folder)
            image_path = root_folder / "acte échantillon.png"
            Image.new("RGB", (18, 22), "white").save(image_path)
            database_path = root_folder / "private" / "smoke.sqlite3"
            previous_database = app.DATABASE
            app.DATABASE = database_path

            def children(parent):
                result = []
                for child in parent.winfo_children():
                    result.append(child)
                    result.extend(children(child))
                return result

            def mainloop_automatique(window):
                window.withdraw()
                window.update()
                buttons = [child for child in children(window) if isinstance(child, tk.Button) or child.winfo_class() == "TButton"]
                import_button = next(button for button in buttons if "Référencer des images" in button.cget("text"))
                import_button.invoke()
                window.update()
                fixture_button = next(button for button in children(window) if button.winfo_class() == "TButton" and "Adapter fixture" in button.cget("text"))
                fixture_button.invoke()
                window.update()
                text_widgets = [child for child in children(window) if isinstance(child, tk.Text)]
                text_widgets[-1].insert("1.0", "Trascrizione di prova")
                save_button = next(button for button in children(window) if button.winfo_class() == "TButton" and "Enregistrer nouvelle référence humaine" in button.cget("text"))
                save_button.invoke()
                window.update()
                status_values = [
                    window.getvar(child.cget("textvariable"))
                    for child in children(window)
                    if child.winfo_class() == "TLabel" and child.cget("textvariable")
                ]
                if not any("CER 0.0000 · WER 0.0000" in value for value in status_values):
                    raise AssertionError(f"Mesures de référence non affichées : {status_values}")
                window.destroy()

            try:
                with patch("tkinter.filedialog.askopenfilenames", return_value=[str(image_path)]), \
                     patch("tkinter.simpledialog.askstring", side_effect=["Trascrizione di prova", "revisora"]), \
                     patch("tkinter.messagebox.askyesno", return_value=True), \
                     patch("tkinter.messagebox.showerror", side_effect=AssertionError), \
                     patch.object(tk.Misc, "mainloop", mainloop_automatique):
                    app.launch_gui()
                state = LocalStore(database_path)
                self.assertEqual(state.summary()["documents"], 1)
                self.assertEqual(state.summary()["runs"], 1)
                self.assertEqual(state.summary()["references"], 1)
            finally:
                app.DATABASE = previous_database


if __name__ == "__main__":
    unittest.main()
