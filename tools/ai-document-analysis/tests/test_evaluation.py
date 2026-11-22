import unittest

from document_analysis.evaluation import edit_distance, measure_transcription, normalize_for_scoring


class EvaluationTests(unittest.TestCase):
    def test_levenshtein_et_scores_identiques(self):
        self.assertEqual(edit_distance("", "abc"), 3)
        self.assertEqual(edit_distance("kitten", "sitting"), 3)
        metrics = measure_transcription("Città di Varese", "Città di Varese")
        self.assertEqual((metrics.cer, metrics.wer, metrics.status), (0.0, 0.0, "scored"))

    def test_scores_ne_suppriment_ni_accents_ni_ponctuation(self):
        self.assertEqual(normalize_for_scoring("  È  Bianchi,  " ), "È Bianchi,")
        metrics = measure_transcription("E Bianchi", "È Bianchi,")
        self.assertGreater(metrics.cer, 0)
        self.assertGreater(metrics.wer, 0)

    def test_nfc_est_applique_sans_supprimer_les_signes(self):
        self.assertEqual(normalize_for_scoring("e\u0300"), "è")
        self.assertEqual(measure_transcription("e\u0300", "è").cer, 0.0)

    def test_reference_absente_ou_vide_ne_divise_jamais_par_zero(self):
        missing = measure_transcription("proposition", None)
        empty = measure_transcription("proposition", "   \n")
        self.assertEqual((missing.status, missing.cer, missing.wer), ("reference-missing", None, None))
        self.assertEqual((empty.status, empty.cer, empty.wer), ("reference-empty", None, None))

    def test_prediction_vide_avec_reference_non_vide_score_cent_pour_cent(self):
        metrics = measure_transcription("", "atto storico")
        self.assertEqual(metrics.cer, 1.0)
        self.assertEqual(metrics.wer, 1.0)


if __name__ == "__main__":
    unittest.main()
