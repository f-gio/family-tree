from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .documents import DocumentLoadError, inspect_image
from .engines import DEFAULT_INSTRUCTIONS, available_engines
from .evaluation import measure_transcription
from .runner import run_engine
from .settings import load_config
from .storage import LocalStore

ROOT = Path(__file__).resolve().parents[1]
CONFIG = load_config(os.environ.get("DOCUMENT_ANALYSIS_CONFIG", ROOT / "config.json"))
DATA_DIR = Path(os.environ.get("DOCUMENT_ANALYSIS_DATA_DIR", ROOT / CONFIG["data_dir"])).expanduser()
DATABASE = DATA_DIR / "prototype.sqlite3"


def store() -> LocalStore:
    return LocalStore(DATABASE)


def import_paths(local_store: LocalStore, paths: list[str], maximum_image_bytes: int) -> tuple[int, list[str]]:
    imported = 0
    errors = []
    for value in paths:
        try:
            document = inspect_image(value, maximum_bytes=maximum_image_bytes)
            if local_store.register_document(document):
                imported += 1
        except (DocumentLoadError, OSError) as error:
            errors.append(f"{value} : {error}")
    return imported, errors


def run_cli() -> int:
    parser = argparse.ArgumentParser(description="Benchmark local de transcription historique (aucun service distant).")
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("import", help="Référencer des images locales JPEG/PNG sans les copier")
    add.add_argument("paths", nargs="+")
    commands.add_parser("list", help="Lister les documents et leurs empreintes")
    run = commands.add_parser("run-fixture", help="Lancer la fixture déterministe non-IA")
    run.add_argument("document_id")
    run.add_argument("--text", required=True, help="Texte fourni explicitement ; aucune lecture d’image")
    reference = commands.add_parser("reference", help="Ajouter une nouvelle révision de référence humaine")
    reference.add_argument("document_id")
    reference.add_argument("--text", required=True)
    reference.add_argument("--reviewer", required=True)
    reference.add_argument("--note", default="")
    evaluate = commands.add_parser("evaluate", help="Évaluer les propositions contre la dernière référence humaine")
    evaluate.add_argument("document_id")
    commands.add_parser("summary", help="Résumé des documents, exécutions, références et scores")
    args = parser.parse_args()
    local_store = store()

    try:
        if args.command == "import":
            count, errors = import_paths(local_store, args.paths, CONFIG["maximum_image_bytes"])
            print(f"Images référencées (sans copie) : {count}")
            for error in errors:
                print(f"ERREUR : {error}", file=sys.stderr)
            return 1 if errors else 0
        if args.command == "list":
            for item in local_store.list_documents():
                print(f"{item['document_id']}\t{item['path']}\t{item['width']}×{item['height']}")
            return 0
        if args.command == "run-fixture":
            run_id, result = run_engine(local_store, args.document_id, available_engines()["fixture-text"], {"text": args.text}, maximum_image_bytes=CONFIG["maximum_image_bytes"])
            print(f"Exécution {run_id} — moteur fixture-text (non IA) — coût local : 0 EUR.")
            print("Proposition fixture :")
            print(result.text)
            return 0
        if args.command == "reference":
            reference_id = local_store.add_human_reference(args.document_id, args.text, args.reviewer, args.note)
            print(f"Référence humaine enregistrée (nouvelle révision append-only) : {reference_id}")
            return 0
        if args.command == "evaluate":
            count = local_store.evaluate_document(args.document_id)
            print(f"Nouvelles évaluations enregistrées : {count}")
            for item in local_store.list_results(args.document_id):
                if item["proposal_id"]:
                    metrics = measure_transcription(item["text"], (local_store.latest_reference(args.document_id) or {}).get("text"))
                    cer = "indisponible" if metrics.cer is None else f"{metrics.cer:.4f}"
                    wer = "indisponible" if metrics.wer is None else f"{metrics.wer:.4f}"
                    print(f"{item['engine_id']} {item['run_id']} : CER {cer} · WER {wer} · {metrics.status}")
            return 0
        if args.command == "summary":
            print(json.dumps(local_store.summary(), ensure_ascii=False, indent=2))
            return 0
    except (KeyError, ValueError, OSError) as error:
        print(f"ERREUR : {error}", file=sys.stderr)
        return 1
    return 2


def launch_gui() -> None:
    try:
        import tkinter as tk
        from tkinter import filedialog, messagebox, simpledialog, ttk
        from PIL import Image, ImageTk
    except ImportError as error:
        raise SystemExit("Interface indisponible : installez Pillow et vérifiez que Python inclut Tkinter.") from error

    local_store = store()
    root = tk.Tk()
    root.title("Analyse documentaire — prototype local")
    root.geometry("1250x850")
    root.minsize(900, 650)
    selected_id: str | None = None
    selected_image = None
    zoom = 1.0
    documents_by_label: dict[str, str] = {}

    toolbar = ttk.Frame(root, padding=8)
    toolbar.pack(fill="x")
    ttk.Label(toolbar, text="Prototype local — aucun moteur IA connecté", foreground="#8a4f17").pack(side="left", padx=(0, 16))
    status = tk.StringVar(value=f"Données locales : {local_store.database_path}")
    ttk.Label(root, textvariable=status, padding=(8, 0)).pack(fill="x")
    panes = ttk.Panedwindow(root, orient="horizontal")
    panes.pack(fill="both", expand=True, padx=8, pady=8)
    left = ttk.Frame(panes, padding=6)
    right = ttk.Frame(panes, padding=6)
    panes.add(left, weight=3)
    panes.add(right, weight=2)

    image_box = ttk.LabelFrame(left, text="Image originale (lecture seule)", padding=4)
    image_box.pack(fill="both", expand=True)
    canvas = tk.Canvas(image_box, background="#282828", highlightthickness=0)
    scroll_y = ttk.Scrollbar(image_box, orient="vertical", command=canvas.yview)
    scroll_x = ttk.Scrollbar(image_box, orient="horizontal", command=canvas.xview)
    canvas.configure(yscrollcommand=scroll_y.set, xscrollcommand=scroll_x.set)
    canvas.grid(row=0, column=0, sticky="nsew")
    scroll_y.grid(row=0, column=1, sticky="ns")
    scroll_x.grid(row=1, column=0, sticky="ew")
    image_box.rowconfigure(0, weight=1)
    image_box.columnconfigure(0, weight=1)
    image_item = canvas.create_image(0, 0, anchor="nw")

    def draw_image() -> None:
        nonlocal selected_image
        if selected_id is None:
            return
        record = local_store.get_document(selected_id)
        if not record or not Path(record["path"]).is_file():
            status.set("L’image originale est introuvable ; réimportez le fichier.")
            return
        try:
            inspected = inspect_image(record["path"], maximum_bytes=CONFIG["maximum_image_bytes"])
            if inspected.sha256 != record["sha256"]:
                status.set("L’image a changé depuis son import ; réimportez-la avant toute revue.")
                return
            with Image.open(record["path"]) as image:
                image = image.convert("RGB")
                width = max(1, round(image.width * zoom))
                height = max(1, round(image.height * zoom))
                resized = image.resize((width, height), Image.Resampling.LANCZOS)
                selected_image = ImageTk.PhotoImage(resized)
        except (DocumentLoadError, OSError, ValueError) as error:
            status.set(f"Image non consultable : {error}")
            return
        canvas.itemconfigure(image_item, image=selected_image)
        canvas.configure(scrollregion=(0, 0, selected_image.width(), selected_image.height()))

    def change_zoom(factor: float) -> None:
        nonlocal zoom
        zoom = min(4.0, max(0.2, zoom * factor))
        draw_image()

    zoom_row = ttk.Frame(left)
    zoom_row.pack(fill="x", pady=4)
    ttk.Button(zoom_row, text="− Zoom", command=lambda: change_zoom(0.8)).pack(side="left")
    ttk.Button(zoom_row, text="+ Zoom", command=lambda: change_zoom(1.25)).pack(side="left", padx=4)
    ttk.Button(zoom_row, text="Adapter fixture (non-IA)", command=lambda: run_fixture()).pack(side="right")

    ttk.Label(right, text="Document local").pack(anchor="w")
    document_choice = tk.StringVar()
    document_menu = ttk.Combobox(right, textvariable=document_choice, state="readonly")
    document_menu.pack(fill="x", pady=(2, 8))
    ttk.Label(right, text="Propositions d’exécution (aucune n’est une référence humaine)").pack(anchor="w")
    results = tk.Listbox(right, height=7, exportselection=False)
    results.pack(fill="x", pady=(2, 8))
    ttk.Label(right, text="Transcription proposée / comparaison").pack(anchor="w")
    proposal_text = tk.Text(right, height=9, wrap="word")
    proposal_text.pack(fill="both", expand=True, pady=(2, 8))
    ttk.Label(right, text="Référence humaine — enregistrer crée une nouvelle révision").pack(anchor="w")
    reference_text = tk.Text(right, height=9, wrap="word")
    reference_text.pack(fill="both", expand=True, pady=(2, 4))
    metrics_label = tk.StringVar(value="CER/WER indisponibles tant qu’une référence humaine n’est pas enregistrée.")
    ttk.Label(right, textvariable=metrics_label, wraplength=460).pack(fill="x", pady=4)
    action_row = ttk.Frame(right)
    action_row.pack(fill="x")

    def refresh_documents() -> None:
        nonlocal selected_id
        records = local_store.list_documents()
        documents_by_label.clear()
        for record in records:
            label = f"{Path(record['path']).name} · {record['sha256'][:12]}"
            documents_by_label[label] = record["document_id"]
        document_menu["values"] = list(documents_by_label)
        if records and (selected_id is None or not local_store.get_document(selected_id)):
            selected_id = records[0]["document_id"]
        if selected_id:
            matching = next((label for label, value in documents_by_label.items() if value == selected_id), "")
            document_choice.set(matching)
            show_document()

    def show_document(_event=None) -> None:
        nonlocal selected_id, zoom
        selected_id = documents_by_label.get(document_choice.get())
        results.delete(0, "end")
        proposal_text.delete("1.0", "end")
        if not selected_id:
            return
        zoom = 1.0
        record = local_store.get_document(selected_id)
        draw_image()
        status.set(f"SHA-256 {record['sha256']} · {record['width']}×{record['height']} · original non modifié")
        for result in local_store.list_results(selected_id):
            label = f"{result['engine_id']} · {result['status']} · {result['run_id'][:8]}"
            results.insert("end", label)
        reference = local_store.latest_reference(selected_id)
        reference_text.delete("1.0", "end")
        if reference:
            reference_text.insert("1.0", reference["text"])
            metrics_label.set(f"Dernière référence humaine v{reference['revision']} · {reference['reviewer']}")
        else:
            metrics_label.set("Aucune référence humaine ; CER/WER indisponibles.")
        if local_store.list_results(selected_id):
            results.selection_set(0)
            select_result(None)

    def select_result(_event) -> None:
        if not selected_id or not results.curselection():
            return
        chosen = local_store.list_results(selected_id)[results.curselection()[0]]
        proposal_text.delete("1.0", "end")
        if chosen["text"] is not None:
            proposal_text.insert("1.0", chosen["text"])
        reference = local_store.latest_reference(selected_id)
        if reference and chosen["text"] is not None:
            metrics = measure_transcription(chosen["text"], reference["text"])
            metrics_label.set(f"CER {metrics.cer:.4f} · WER {metrics.wer:.4f} · référence humaine v{reference['revision']}" if metrics.status == "scored" else f"Mesure indisponible : {metrics.status}")
        else:
            metrics_label.set("CER/WER indisponibles tant qu’une référence humaine n’est pas enregistrée.")

    def run_fixture() -> None:
        if not selected_id:
            messagebox.showinfo("Document requis", "Importez puis sélectionnez une image locale.")
            return
        text = simpledialog.askstring("Fixture locale non-IA", "Texte fixture à enregistrer comme proposition de démonstration :", parent=root)
        if text is None:
            return
        try:
            run_engine(local_store, selected_id, available_engines()["fixture-text"], {"text": text}, DEFAULT_INSTRUCTIONS, CONFIG["maximum_image_bytes"])
            show_document()
            status.set("Proposition fixture enregistrée. Ce texte n’a pas été reconnu depuis l’image.")
        except Exception as error:
            messagebox.showerror("Exécution échouée", str(error))

    def import_images() -> None:
        paths = filedialog.askopenfilenames(
            title="Choisir des images à référencer localement",
            filetypes=[("Images JPEG/PNG", "*.jpg *.jpeg *.png"), ("Tous les fichiers", "*.*")],
        )
        if not paths:
            return
        count, errors = import_paths(local_store, list(paths), CONFIG["maximum_image_bytes"])
        refresh_documents()
        message = f"Images référencées sans copie : {count}."
        if errors:
            message += "\n\n" + "\n".join(errors)
        status.set(message.replace("\n", " "))
        if errors:
            messagebox.showwarning("Import local", message)

    def save_reference() -> None:
        if not selected_id:
            messagebox.showinfo("Document requis", "Sélectionnez un document.")
            return
        text = reference_text.get("1.0", "end-1c")
        reviewer = simpledialog.askstring("Validation humaine", "Nom ou identifiant local du correcteur :", parent=root)
        if reviewer is None:
            return
        if not messagebox.askyesno("Confirmer la référence", "Enregistrer ce texte comme nouvelle révision de référence humaine ? Les anciennes références seront conservées."):
            return
        try:
            local_store.add_human_reference(selected_id, text, reviewer)
            show_document()
        except ValueError as error:
            messagebox.showerror("Référence non enregistrée", str(error))

    ttk.Button(toolbar, text="Référencer des images…", command=import_images).pack(side="right")
    ttk.Button(action_row, text="Enregistrer nouvelle référence humaine", command=save_reference).pack(side="left")
    ttk.Button(action_row, text="Rafraîchir", command=refresh_documents).pack(side="right")
    document_menu.bind("<<ComboboxSelected>>", show_document)
    results.bind("<<ListboxSelect>>", select_result)
    root.bind("<Control-MouseWheel>", lambda event: change_zoom(1.15 if event.delta > 0 else 0.87))
    refresh_documents()
    root.mainloop()


def main() -> None:
    if len(sys.argv) > 1:
        raise SystemExit(run_cli())
    launch_gui()


if __name__ == "__main__":
    main()
