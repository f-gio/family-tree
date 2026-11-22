from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import tkinter as tk
from PIL import Image

from document_analysis import app
from document_analysis.contracts import EngineResult
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
                engine_menu = next(
                    widget for widget in children(window)
                    if widget.winfo_class() == "TCombobox" and "fixture-text" in widget.cget("values")
                )
                if list(engine_menu.cget("values")) != ["fixture-text"]:
                    raise AssertionError(
                        f"Seul fixture-text doit rester sélectionnable : {engine_menu.cget('values')}"
                    )
                engine_menu.set("fixture-text")
                run_button = next(button for button in children(window) if button.winfo_class() == "TButton" and "Lancer le moteur choisi" in button.cget("text"))
                run_button.invoke()
                deadline = time.monotonic() + 10
                while app.store().summary()["runs"] == 0 and time.monotonic() < deadline:
                    window.update()
                    time.sleep(0.01)
                window.update()
                if app.store().summary()["runs"] != 1:
                    raise AssertionError("La fixture UI n’a pas terminé son exécution en arrière-plan.")
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

    def test_selection_d_un_moteur_le_branche_en_arriere_plan_sans_bloquer_l_interface(self):
        with tempfile.TemporaryDirectory() as folder:
            root_folder = Path(folder)
            image_path = root_folder / "page-test.png"
            Image.new("RGB", (24, 20), "white").save(image_path)
            database_path = root_folder / "private" / "smoke-engine.sqlite3"
            previous_database = app.DATABASE

            class LongRunningEngineDouble:
                engine_id = "moteur-factice-long"

                def transcribe(self, request):
                    return EngineResult(
                        engine_id=self.engine_id,
                        model_reference="double-de-cablage-unitaire",
                        text="Sortie du moteur de test (pas une inférence réelle)",
                        duration_ms=1,
                        cost_eur=0.0,
                        cost_status="known",
                        confidence="unknown",
                        provenance={"kind": "unit-test-double", "run_id": request.run_id},
                    )

            def children(parent):
                result = []
                for child in parent.winfo_children():
                    result.append(child)
                    result.extend(children(child))
                return result

            failures = []
            original_mainloop = tk.Misc.mainloop

            def mainloop_automatique(window, *args, **kwargs):
                def drive_window():
                    try:
                        window.withdraw()
                        button = next(widget for widget in children(window) if widget.winfo_class() == "TButton" and "Référencer des images" in widget.cget("text"))
                        button.invoke()
                        engine_menu = next(widget for widget in children(window) if widget.winfo_class() == "TCombobox" and "moteur-factice-long" in widget.cget("values"))
                        engine_menu.set("moteur-factice-long")
                        run_button = next(widget for widget in children(window) if widget.winfo_class() == "TButton" and "Lancer le moteur choisi" in widget.cget("text"))
                        start = time.monotonic()
                        run_button.invoke()
                        self.assertLess(time.monotonic() - start, 0.5, "L’interface doit rendre la main pendant l’exécution.")
                        document_id = app.store().list_documents()[0]["document_id"]
                        deadline = time.monotonic() + 10

                        def poll_result():
                            try:
                                rows = app.store().list_results(document_id)
                                text_widgets = [widget for widget in children(window) if isinstance(widget, tk.Text)]
                                if rows and rows[0]["status"] == "succeeded" and "Sortie du moteur de test" in text_widgets[0].get("1.0", "end-1c"):
                                    self.assertEqual(rows[0]["engine_id"], "moteur-factice-long")
                                    window.destroy()
                                    return
                                if time.monotonic() >= deadline:
                                    raise AssertionError("Le moteur factice n’a pas terminé son parcours UI.")
                                window.after(20, poll_result)
                            except Exception as error:
                                failures.append(str(error))
                                window.destroy()

                        window.after(20, poll_result)
                    except Exception as error:
                        failures.append(str(error))
                        window.destroy()

                window.after_idle(drive_window)
                return original_mainloop(window, *args, **kwargs)

            app.DATABASE = database_path
            try:
                with patch("document_analysis.app.available_engines", return_value={"moteur-factice-long": LongRunningEngineDouble()}), \
                     patch("tkinter.filedialog.askopenfilenames", return_value=[str(image_path)]), \
                     patch("tkinter.messagebox.showerror", side_effect=lambda _title, message: failures.append(message)), \
                     patch.object(tk.Misc, "mainloop", mainloop_automatique):
                    app.launch_gui()
                self.assertEqual(failures, [])
            finally:
                app.DATABASE = previous_database


if __name__ == "__main__":
    unittest.main()
