import argparse
import json
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import evaluate as ev
from metrics import normalize, text_metrics, scene_metrics, timing_metrics


class MetricsTests(unittest.TestCase):
    def test_source_identity_golden_matches_node_contract(self):
        golden = json.loads((Path(__file__).parent / "source-identity-golden.json").read_text(encoding="utf-8"))
        canonical = json.dumps(golden["value"], sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        self.assertEqual(canonical, golden["canonicalJson"])
        self.assertEqual(ev.fingerprint(golden["value"]), golden["sha256"])

    def test_vietnamese_nfc_diacritics_and_digits(self):
        self.assertEqual(normalize("  TÔI, có 12! "), "tôi có 12")
        self.assertEqual(normalize("a\u0301"), "á")
        self.assertNotEqual(normalize("ma"), normalize("má"))

    def test_numeric_punctuation_is_not_erased(self):
        self.assertNotEqual(normalize("3.14"), normalize("314"))
        self.assertNotEqual(normalize("-12"), normalize("12"))
        self.assertEqual(normalize("Có 12, rồi 13."), "có 12 rồi 13")

    def test_known_edit_distance_and_empty_gold(self):
        value = text_metrics("một hai ba", "một ba")
        self.assertEqual(value["whitespaceTokens"]["edits"], 1)
        self.assertAlmostEqual(value["whitespaceTokens"]["rate"], 1/3)
        empty = text_metrics("", "lời bị bịa")
        self.assertIsNone(empty["characters"]["rate"])
        self.assertEqual(empty["falseSpeechTokens"], 3)
        self.assertEqual(text_metrics("á", "a")["characters"]["edits"], 1)

    def test_scene_matching_is_one_to_one(self):
        result = scene_metrics([1, 2], [.9, 1.05, 2.2])
        self.assertEqual(result["matched"], 2)
        self.assertAlmostEqual(result["precision"], 2/3)
        self.assertEqual(result["recall"], 1)
        self.assertIsNone(scene_metrics([], [1])["recall"])
        for times in ([1, 1], [float("nan")], [-1]):
            with self.assertRaises(ValueError):
                scene_metrics(times, [])

    def test_explicit_timing_and_empty_are_not_passes(self):
        self.assertIsNone(timing_metrics([])["p95Seconds"])
        result = timing_metrics([{"reference": [1, 2], "hypothesis": [1.1, 2.4]}])
        self.assertAlmostEqual(result["p95Seconds"], .4)
        with self.assertRaises(ValueError):
            timing_metrics([{"reference": [2, 1], "hypothesis": [1, 2]}])


class CorpusTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.media = self.root / "video.mp4"
        self.media.write_bytes(b"original media")
        self.clip = {"id": "clip-test", "path": "video.mp4", "sha256": ev.digest(self.media),
                     "split": "development", "group": "vi_clean", "durationSeconds": 20,
                     "sourceGroup": "course", "speakerGroup": "speaker", "annotation": "gold.json",
                     "annotationVersion": "1", "streams": [{"codec_type": "audio", "index": 1}]}
        self.manifest = {"version": "1.0", "root": str(self.root), "clips": [self.clip]}
        self.manifest_path = self.root / "corpus.json"
        ev.write(self.manifest_path, self.manifest)

    def test_source_hash_and_path_escape(self):
        self.assertEqual(ev.source_path(self.manifest, self.clip), self.media)
        self.media.write_bytes(b"changed media")
        with self.assertRaises(ValueError):
            ev.source_path(self.manifest, self.clip)
        self.clip["path"] = "../outside.mp4"
        with self.assertRaises((ValueError, FileNotFoundError)):
            ev.source_path(self.manifest, self.clip)

    def test_missing_gold_blocks_audit(self):
        result = ev.audit(argparse.Namespace(manifest=self.manifest_path))
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(result["verifiedClips"], 0)
        self.assertFalse(result["releaseAccepted"])

    def test_score_rejects_machine_gold_and_coverage_mismatch(self):
        prediction = {"text": "xin chào", "coverage": [0, 20]}
        ev.write(self.root / "prediction.json", prediction)
        report = {"operation": "asr", "clips": [{"id": "clip-test", "status": "completed",
                  "split": "development", "sourceHash": self.clip["sha256"],
                  "prediction": "prediction.json", "predictionHash": ev.digest(self.root / "prediction.json")}]}
        ev.write(self.root / "report.json", report)
        annotation = {"status": "machine_draft", "reviewer": None, "text": "xin chào",
                      "sourceHash": self.clip["sha256"], "version": "1", "coverage": [0, 20]}
        args = argparse.Namespace(manifest=self.manifest_path, report=self.root / "report.json", output=self.root / "score.json")
        ev.write(self.root / "gold.json", annotation)
        self.assertEqual(ev.score(args)["clips"][0]["status"], "unscored")
        annotation.update(status="human_verified", reviewer="test reviewer")
        ev.write(self.root / "gold.json", annotation)
        result = ev.score(args)
        self.assertEqual(result["clips"][0]["metrics"]["characters"]["rate"], 0)
        self.assertFalse(result["releaseAccepted"])
        annotation["coverage"] = [0, 10]
        ev.write(self.root / "gold.json", annotation)
        self.assertEqual(ev.score(args)["clips"][0]["status"], "unscored")
        annotation["coverage"] = [0, 20]
        ev.write(self.root / "gold.json", annotation)
        ev.write(self.root / "prediction.json", {"text": "tampered"})
        self.assertEqual(ev.score(args)["clips"][0]["status"], "unscored")

    def test_metadata_tampering_cannot_inflate_benchmark_duration(self):
        actual = {"format": {"duration": "20"}, "streams": [{"index": 1, "codec_type": "audio"}]}
        with patch.object(ev, "probe", return_value=actual):
            self.assertEqual(ev.verify_metadata(self.media, self.clip), actual)
            altered = dict(self.clip, durationSeconds=2000)
            with self.assertRaises(ValueError):
                ev.verify_metadata(self.media, altered)

    def test_complete_synthetic_schema_can_lock_and_detect_gold_change(self):
        # Structural fixture only: never used or reported as a real quality corpus.
        clips = []
        tags = ["north", "central", "south", "english", "code_switch", "names_numbers", "noise_music",
                "quiet_speech", "overlap", "conversation", "flash", "pan", "fade", "slides", "long_shot"]
        for index in range(36):
            media = self.root / (str(index) + ".mp4")
            media.write_bytes(str(index).encode())
            clip = dict(self.clip, id="clip-" + str(index), path=media.name, sha256=ev.digest(media),
                        durationSeconds=150, split="development" if index < 14 else "holdout",
                        speakerGroup=str(index), sourceGroup=str(index), tags=tags,
                        group="vi_clean" if index < 8 else "vi_hard" if index < 16 else "no_speech" if index < 20 else "other",
                        streams=[{"codec_type": "audio"}, {"codec_type": "video"}], annotation=str(index)+".json")
            ev.write(self.root / clip["annotation"], {"version": "1", "sourceHash": clip["sha256"],
                     "status": "human_verified", "reviewer": "schema-test-fixture", "coverage": [0, 150],
                     "text": "" if clip["group"] == "no_speech" else "fixture", "cuts": [10, 20, 30],
                     "segments": [] if clip["group"] == "no_speech" else [{"startSeconds": i, "endSeconds": i+.5} for i in range(5)]})
            clips.append(clip)
        ev.write(self.manifest_path, dict(self.manifest, clips=clips))
        args = argparse.Namespace(manifest=self.manifest_path, output=self.root/"holdout.json", reviewer="schema-test")
        self.assertEqual(ev.audit(args)["blockers"], [])
        lock = ev.lock_holdout(args)
        self.assertEqual(lock["evidenceLock"], ev.evidence_lock(self.manifest_path))
        path = self.root / clips[0]["annotation"]
        gold = ev.read(path)
        gold["text"] = "changed"
        ev.write(path, gold)
        self.assertNotEqual(lock["evidenceLock"], ev.evidence_lock(self.manifest_path))
        with self.assertRaises(ValueError):
            ev.lock_holdout(args)

    def test_annotation_timing_must_be_finite_and_in_source(self):
        annotation = {"status": "human_verified", "reviewer": "test", "version": "1", "sourceHash": self.clip["sha256"],
                      "coverage": [0, 20], "text": "test", "cuts": [30]}
        with self.assertRaises(ValueError):
            ev.validate_annotation(annotation, self.clip)
        annotation["cuts"] = []
        annotation["segments"] = [{"startSeconds": 0, "endSeconds": float("nan")}]
        with self.assertRaises(ValueError):
            ev.validate_annotation(annotation, self.clip)

    def test_dependency_drift_is_rejected(self):
        with patch.object(ev.importlib.metadata, "version", return_value="0.0.fake"):
            with self.assertRaises(ValueError):
                ev.validate_dependencies("cpu")

    def test_model_manifest_cannot_self_authorize_modified_model(self):
        path = self.root / "models" / "large-v3"
        path.mkdir(parents=True)
        ev.write(path / "model-manifest.json", {"model": "large-v3", "revision": "wrong", "files": {"model.bin": "wrong"}})
        with patch.object(ev, "LOCAL", self.root):
            with self.assertRaises(ValueError):
                ev.verified_model("large-v3")

    def test_chunk_midpoint_owns_boundary_word_once(self):
        calls = []
        def transcribe(path, **options):
            first = not calls
            calls.append(options)
            times = [(0, .5, "hello"), (4.9, 5.1, " boundary")] if first else [(.9, 1.1, " boundary"), (5, 5.5, " end")]
            words = [SimpleNamespace(start=a, end=b, word=text, probability=.8) for a, b, text in times]
            segment = SimpleNamespace(words=words, start=0, end=6, text="unused")
            return iter([segment]), SimpleNamespace(language="vi", language_probability=.9)
        model = SimpleNamespace(transcribe=transcribe)
        profile = {"chunkSeconds": 5, "overlapSeconds": 1, "language": "vi", "beamSize": 5, "vad": True}
        with patch.object(ev, "LOCAL", self.root), patch.object(ev, "command"):
            result = ev.transcribe(model, self.media, self.clip, profile, 10, 1)
        self.assertEqual(result["text"], "hello boundary end")
        self.assertEqual(len(result["chunks"]), 2)
        self.assertEqual(result["chunks"][1]["decodeRange"], [4, 10])
        self.assertAlmostEqual(result["segments"][1]["words"][0]["startSeconds"], 4.9)

    def test_label_preparation_preserves_unlabelled_vs_no_speech(self):
        destination = self.root / "review.json"
        result = ev.prepare_labels(argparse.Namespace(manifest=self.manifest_path, output=destination))
        review = ev.read(destination)
        gold = ev.read(self.root / review["clips"][0]["annotation"])
        self.assertIsNone(gold["text"])
        self.assertIsNone(gold["cuts"])
        self.assertEqual(gold["status"], "needs_human_review")
        with self.assertRaises(ValueError):
            ev.prepare_labels(argparse.Namespace(manifest=self.manifest_path, output=destination))

    def test_unlabelled_text_does_not_count_as_qualified_audio(self):
        annotation = {"status": "human_verified", "reviewer": "test", "sourceHash": self.clip["sha256"],
                      "version": "1", "coverage": [0, 20], "text": None, "cuts": None}
        ev.write(self.root / "gold.json", annotation)
        result = ev.audit(argparse.Namespace(manifest=self.manifest_path))
        self.assertEqual(result["verifiedAudioSeconds"], 0)
        self.assertEqual(result["status"], "blocked")

    def test_holdout_lock_rejects_missing_corpus(self):
        with self.assertRaises(ValueError):
            ev.lock_holdout(argparse.Namespace(manifest=self.manifest_path, output=self.root / "lock.json", reviewer="test"))
        self.assertFalse((self.root / "lock.json").exists())

    def test_atomic_json_rejects_nan_without_destroying_previous(self):
        target = self.root / "record.json"
        ev.write(target, {"good": True})
        with self.assertRaises(ValueError):
            ev.write(target, {"bad": float("nan")})
        self.assertEqual(ev.read(target), {"good": True})
        self.assertEqual(list(self.root.glob("*.tmp")), [])

    def test_inventory_does_not_overwrite_labels(self):
        args = argparse.Namespace(source=self.root, output=self.manifest_path, provenance="test")
        with patch.object(ev, "probe", return_value={"format": {"duration": "20"}, "streams": []}):
            with self.assertRaises(ValueError):
                ev.inventory(args)
        self.assertEqual(ev.read(self.manifest_path), self.manifest)


if __name__ == "__main__":
    unittest.main()
