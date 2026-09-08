"""Package A: local evaluation harness, deliberately outside project runtime.

Only setup-model downloads. All other commands are offline. stdout is JSON.
"""
import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import normalize, text_metrics, scene_metrics, timing_metrics

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
LOCAL = REPO / ".cache" / "source-eval"
VERSION = "1.0"
DLL_HANDLES = []
EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm", ".wav", ".mp3", ".m4a", ".flac", ".ogg", ".opus"}


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def digest(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def command(args, timeout=60):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True,
                          encoding="utf-8", errors="replace", check=True, timeout=timeout,
                          creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


def probe(path):
    return json.loads(command([os.environ.get("PADSTUDIO_FFPROBE_PATH", "ffprobe"),
                               "-v", "error", "-protocol_whitelist", "file,pipe", "-show_format",
                               "-show_streams", "-of", "json", path]).stdout)


def package_versions():
    names = ["faster-whisper", "ctranslate2", "scenedetect", "opencv-python", "av", "onnxruntime", "psutil", "numpy", "nvidia-cublas-cu12", "nvidia-cudnn-cu12", "nvidia-cuda-nvrtc-cu12"]
    result = {}
    for name in names:
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = None
    return result


def validate_dependencies(device):
    files = [HERE / "requirements-cpu.lock.txt"]
    if device == "cuda" and os.name == "nt":
        files.append(HERE / "requirements-windows-gpu.lock.txt")
    mismatches = []
    for path in files:
        for line in path.read_text().splitlines():
            if "==" not in line or line.startswith("#"):
                continue
            name, expected = line.split("==", 1)
            try:
                actual = importlib.metadata.version(name)
            except importlib.metadata.PackageNotFoundError:
                actual = None
            if actual != expected:
                mismatches.append({"package": name, "expected": expected, "actual": actual})
    if mismatches:
        raise ValueError("Dependency lock mismatch: " + json.dumps(mismatches))


def doctor(_):
    import psutil
    info = {"version": VERSION, "timestamp": time.time(), "python": sys.version,
            "executable": sys.executable, "platform": platform.platform(),
            "cpu": platform.processor(), "logicalCpus": os.cpu_count(),
            "ramBytes": psutil.virtual_memory().total, "diskFreeBytes": shutil.disk_usage(REPO).free,
            "packages": package_versions(), "executables": {}, "computeTypes": {},
            "models": [], "blockers": [], "inferenceVerified": False}
    for name in ["ffmpeg", "ffprobe", "nvidia-smi"]:
        try:
            args = [os.environ.get("PADSTUDIO_" + name.upper() + "_PATH", name)]
            args += ["--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"] if name == "nvidia-smi" else ["-version"]
            info["executables"][name] = command(args).stdout.splitlines()[0]
        except Exception as error:
            info["blockers"].append({"component": name, "reason": str(error)})
    try:
        import ctranslate2
        for device in ("cpu", "cuda"):
            try:
                info["computeTypes"][device] = sorted(ctranslate2.get_supported_compute_types(device))
            except Exception as error:
                info["blockers"].append({"component": device, "reason": str(error)})
    except ImportError as error:
        info["blockers"].append({"component": "ctranslate2", "reason": str(error)})
    for path in (LOCAL / "models").glob("*/model-manifest.json"):
        manifest = read(path)
        info["models"].append({"model": manifest["model"], "revision": manifest["revision"], "integrityChecked": False})
    for name, version in info["packages"].items():
        if version is None and not name.startswith("nvidia-"):
            info["blockers"].append({"component": name, "reason": "Package missing"})
    if not info["models"]:
        info["blockers"].append({"component": "asr-model", "reason": "No local model; use setup-model"})
    if os.name == "nt":
        import ctypes
        for name in ("cublas64_12.dll", "cudnn64_9.dll"):
            try:
                ctypes.WinDLL(name)
            except OSError as error:
                info["blockers"].append({"component": name, "reason": str(error)})
    info["note"] = "Compute types/package presence do not prove CUDA DLLs or model inference work. Run CPU/GPU baselines."
    return info


def inventory(args):
    root = Path(args.source).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("Source must be a directory")
    rows = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        resolved = path.resolve(strict=True)
        if not resolved.is_relative_to(root):
            raise ValueError("Source link escapes corpus root: " + str(path))
        relative = path.relative_to(root).as_posix()
        row = {"id": "clip-" + fingerprint(relative)[:16], "path": relative,
               "sha256": digest(path), "sizeBytes": path.stat().st_size,
               "source": args.provenance, "license": "owner-authorized-local-evaluation-no-redistribution",
               "split": "unassigned", "group": None, "speakerGroup": None, "sourceGroup": None,
               "annotation": None, "annotationVersion": None}
        try:
            data = probe(path)
            row["durationSeconds"] = float(data["format"]["duration"])
            row["streams"] = [{k: s[k] for k in ("index", "codec_type", "codec_name", "width", "height", "sample_rate", "channels", "time_base", "start_time") if k in s} for s in data["streams"]]
            row["status"] = "inventoried"
        except Exception as error:
            row.update(status="failed", error=str(error))
        if digest(path) != row["sha256"]:
            raise ValueError("Source changed during inventory: " + relative)
        rows.append(row)
    result = {"version": VERSION, "root": str(root), "createdAt": time.time(),
              "purpose": "candidate-corpus-not-gold", "clips": rows,
              "durationSeconds": sum(r.get("durationSeconds", 0) for r in rows)}
    if not rows:
        raise ValueError("No supported media found")
    if Path(args.output).exists():
        raise ValueError("Refusing to overwrite an existing corpus manifest (preserve labels/splits)")
    write(args.output, result)
    return {"manifest": str(Path(args.output).resolve()), "clips": len(rows),
            "durationSeconds": result["durationSeconds"], "failed": sum(r["status"] == "failed" for r in rows)}


def setup_model(args):
    # Deliberately separate online command; inference only opens verified local files.
    from huggingface_hub import HfApi, snapshot_download
    repo = "Systran/faster-whisper-" + args.model
    pinned = read(HERE / "models.lock.json")["models"][args.model]
    revision = HfApi().model_info(repo, revision=args.revision or pinned["revision"]).sha
    if revision != pinned["revision"]:
        raise ValueError("Model revision differs from checked-in lock; update the experimental lock explicitly")
    destination = LOCAL / "models" / args.model
    if (destination / "model-manifest.json").exists():
        old = read(destination / "model-manifest.json")
        if old["revision"] != revision:
            raise ValueError("Existing model revision differs; use the pinned revision or a separate workspace")
    snapshot_download(repo, revision=revision, local_dir=destination,
                      allow_patterns=["*.json", "*.bin", "*.txt"])
    files = {p.relative_to(destination).as_posix(): digest(p) for p in sorted(destination.iterdir()) if p.is_file() and p.name != "model-manifest.json"}
    if files != pinned["files"]:
        raise ValueError("Downloaded model checksums differ from lock")
    if "model.bin" not in files:
        raise ValueError("Downloaded snapshot has no model.bin")
    result = {"version": VERSION, "model": args.model, "repository": repo,
              "revision": revision, "files": files, "downloadedAt": time.time()}
    write(destination / "model-manifest.json", result)
    return result


def verified_model(name):
    directory = LOCAL / "models" / name
    manifest = read(directory / "model-manifest.json")
    pinned = read(HERE / "models.lock.json")["models"][name]
    if manifest["revision"] != pinned["revision"] or manifest["files"] != pinned["files"]:
        raise ValueError("Local model differs from checked-in lock")
    if manifest["model"] != name or not manifest["files"]:
        raise ValueError("Invalid model manifest")
    for file, expected in manifest["files"].items():
        path = (directory / file).resolve()
        if not path.is_relative_to(directory.resolve()) or digest(path) != expected:
            raise ValueError("Model integrity mismatch: " + file)
    return directory, manifest


def source_path(manifest, clip):
    root = Path(manifest["root"]).resolve(strict=True)
    path = (root / clip["path"]).resolve(strict=True)
    if not path.is_relative_to(root) or digest(path) != clip["sha256"]:
        raise ValueError("Source missing/changed/escaped: " + clip["id"])
    return path


def verify_metadata(path, clip):
    actual = probe(path)
    duration = float(actual["format"]["duration"])
    expected_tracks = [(s["index"], s["codec_type"]) for s in clip["streams"]]
    actual_tracks = [(s["index"], s["codec_type"]) for s in actual["streams"]]
    if not math.isfinite(duration) or abs(duration-clip["durationSeconds"]) > .001 or expected_tracks != actual_tracks:
        raise ValueError("Manifest metadata differs from source; re-inventory before benchmark")
    return actual


class Monitor:
    def __init__(self):
        self.stop = threading.Event()
        self.peak = 0
        self.gpu = None
        self.samples = 0

    def sample(self):
        import psutil
        while not self.stop.is_set():
            process = psutil.Process()
            processes = [process] + process.children(recursive=True)
            total = 0
            for item in processes:
                try:
                    total += item.memory_info().rss
                except psutil.Error:
                    pass
            self.peak = max(self.peak, total)
            try:
                output = command(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"], timeout=3).stdout
                used = sum(int(line.strip()) for line in output.splitlines()) * 1024 * 1024
                self.gpu = max(self.gpu or 0, used)
            except Exception:
                pass
            self.samples += 1
            self.stop.wait(.5)

    def __enter__(self):
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join(timeout=5)

    def report(self):
        return {"peakProcessTreeRssBytesSampled": self.peak, "peakGpuDeviceUsedBytesSampled": self.gpu,
                "samples": self.samples, "gpuScope": "whole-device-including-other-apps", "sampleIntervalSeconds": .5}


def transcribe(model, path, clip, profile, duration, audio_stream):
    ffmpeg = os.environ.get("PADSTUDIO_FFMPEG_PATH", "ffmpeg")
    rows, chunks = [], []
    ownership = 0.0
    with tempfile.TemporaryDirectory(prefix="audio-", dir=LOCAL) as temporary:
        while ownership < duration:
            end = min(duration, ownership + profile["chunkSeconds"])
            left = max(0, ownership - profile["overlapSeconds"])
            right = min(duration, end + profile["overlapSeconds"])
            wav = Path(temporary) / "window.wav"
            command([ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-y", "-protocol_whitelist", "file,pipe",
                     "-ss", left, "-i", path, "-t", right-left, "-map", "0:" + str(audio_stream),
                     "-vn", "-ac", "1", "-ar", "16000", wav], timeout=max(60, (right-left)*3))
            started = time.perf_counter()
            segments, info = model.transcribe(str(wav), language=profile["language"],
                                              beam_size=profile["beamSize"], word_timestamps=True,
                                              vad_filter=profile["vad"], condition_on_previous_text=False,
                                              temperature=0, vad_parameters={"min_silence_duration_ms": 500})
            for segment in segments:
                diagnostics = {"avgLogprob": getattr(segment, "avg_logprob", None),
                               "compressionRatio": getattr(segment, "compression_ratio", None),
                               "noSpeechProbability": getattr(segment, "no_speech_prob", None)}
                words = []
                for word in segment.words or []:
                    start, finish = left + word.start, left + word.end
                    if ownership <= (start + finish) / 2 < end:
                        words.append({"text": word.word, "startSeconds": start, "endSeconds": finish,
                                      "score": word.probability})
                if words:
                    rows.append({"id": "segment-" + str(len(rows)), "text": "".join(w["text"] for w in words).strip(),
                                 "startSeconds": words[0]["startSeconds"], "endSeconds": words[-1]["endSeconds"],
                                 "words": words, "chunk": len(chunks), "diagnostics": diagnostics})
                elif not segment.words:
                    midpoint = left + (segment.start + segment.end)/2
                    if ownership <= midpoint < end:
                        rows.append({"id": "segment-" + str(len(rows)), "text": segment.text.strip(),
                                     "startSeconds": None, "endSeconds": None, "words": [],
                                     "chunk": len(chunks), "warning": "unaligned", "diagnostics": diagnostics})
            chunks.append({"ownership": [ownership, end], "decodeRange": [left, right],
                           "inferenceSeconds": time.perf_counter()-started, "language": info.language,
                           "languageProbability": info.language_probability})
            ownership = end
    for row in rows:
        for word in row["words"]:
            if not 0 <= word["startSeconds"] <= word["endSeconds"] <= duration + .05:
                raise ValueError("ASR timestamp outside decoded source range")
    warnings = []
    if any(r["startSeconds"] is None for r in rows):
        warnings.append("unaligned_segments")
    timed = [r for r in rows if r["startSeconds"] is not None]
    if any(b["startSeconds"] < a["endSeconds"] for a, b in zip(timed, timed[1:])):
        warnings.append("segment_timing_overlap_requires_review")
    return {"warnings": warnings, "segments": rows, "text": " ".join(r["text"] for r in rows), "chunks": chunks,
            "audioStream": audio_stream, "coverage": [0, duration], "review": "not_performed",
            "outcome": "produced" if rows else "no_speech_detected"}


def detect_scenes(path, options, duration):
    from scenedetect import open_video, SceneManager
    from scenedetect.detectors import AdaptiveDetector
    video = open_video(str(path), backend="pyav")
    manager = SceneManager()
    manager.add_detector(AdaptiveDetector(adaptive_threshold=options["adaptiveThreshold"],
                         min_scene_len=options["minSceneLengthFrames"], window_width=options["windowWidth"],
                         min_content_val=options["minContentValue"]))
    manager.detect_scenes(video=video, end_time=duration, show_progress=False)
    scenes = manager.get_scene_list(start_in_scene=True)
    intervals = [[a.seconds, b.seconds] for a, b in scenes]
    if not intervals or any(not 0 <= a < b <= duration + .1 for a, b in intervals):
        raise ValueError("Scene decoder returned no valid intervals or invalid timestamps")
    return {"intervals": intervals, "cuts": [s[0] for s in intervals[1:]],
            "coverage": [0, duration], "review": "not_performed",
            "timebaseWarning": "Baseline PySceneDetect timestamps; VFR/offset golden validation required before runtime integration"}


def run_worker(args):
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    manifest = read(args.manifest)
    profiles = read(HERE / "profiles.json")
    profile = profiles["profiles"][args.profile] if args.operation == "asr" else profiles["scenes"]
    selected = [c for c in manifest["clips"] if not args.clip or c["id"] in args.clip]
    if not selected or (args.clip and set(args.clip) - {c["id"] for c in selected}):
        raise ValueError("Unknown or empty clip selection")
    if any(c["split"] == "holdout" for c in selected) and not args.holdout_lock:
        raise ValueError("Holdout requires --holdout-lock created before inference")
    if args.holdout_lock:
        lock = read(args.holdout_lock)
        if lock.get("evidenceLock") != evidence_lock(args.manifest):
            raise ValueError("Holdout annotations/model/metrics changed since lock")
        if lock["manifestHash"] != digest(args.manifest) or lock["profilesHash"] != digest(HERE / "profiles.json"):
            raise ValueError("Holdout lock mismatch")
    if args.max_seconds is not None and (not math.isfinite(args.max_seconds) or args.max_seconds <= 0):
        raise ValueError("max-seconds must be finite and positive")
    LOCAL.mkdir(parents=True, exist_ok=True)
    run_id = args.run_id
    if not run_id or any(c not in "0123456789-abcdef" for c in run_id):
        raise ValueError("Invalid internal run ID")
    output = LOCAL / "runs" / run_id
    output.mkdir(parents=True, exist_ok=True)
    report = {"version": VERSION, "runId": run_id, "operation": args.operation,
              "profileId": args.profile if args.operation == "asr" else "adaptive-v1", "profile": profile,
              "profilesHash": digest(HERE / "profiles.json"), "manifestHash": digest(args.manifest),
              "harnessHash": digest(__file__), "packages": package_versions(), "clips": [],
              "requestedClipIds": [c["id"] for c in selected],
              "status": "running", "qualityStatus": "unscored", "modelLoadSeconds": None,
              "scope": "smoke-prefix" if args.max_seconds else "full-selected-clips"}
    write(output / "report.json", report)
    report["method"] = {"temperature": 0, "conditionOnPreviousText": False, "wordTimestamps": True,
                        "vadMinSilenceMs": 500, "sampleRate": 16000, "cpuThreads": 8,
                        "chunkOwnership": "word-midpoint-source-time", "timebase": "source-playback-seconds"} if args.operation == "asr" else {"backend": "pyav"}
    report["executables"] = {name: command([os.environ.get("PADSTUDIO_" + name.upper() + "_PATH", name), "-version"]).stdout.splitlines()[0]
                             for name in ("ffmpeg", "ffprobe")}
    model = None
    try:
        validate_dependencies(profile["device"] if args.operation == "asr" else "cpu")
        with Monitor() as monitor:
            if args.operation == "asr":
                from faster_whisper import WhisperModel
                directory, model_manifest = verified_model(profile["model"])
                report["model"] = model_manifest
                started = time.perf_counter()
                model = WhisperModel(str(directory), device=profile["device"], compute_type=profile["computeType"],
                                     cpu_threads=8, local_files_only=True)
                report["modelLoadSeconds"] = time.perf_counter() - started
                report["resolvedComputeType"] = model.model.compute_type
                report["resolvedDevice"] = model.model.device
                if model.model.compute_type != profile["computeType"]:
                    raise ValueError("Backend changed requested precision")
            for clip in selected:
                print("Evaluating " + clip["path"], file=sys.stderr, flush=True)
                entry = {"id": clip["id"], "sourceHash": clip["sha256"], "split": clip["split"], "status": "running"}
                started = time.perf_counter()
                try:
                    path = source_path(manifest, clip)
                    metadata = verify_metadata(path, clip)
                    duration = clip["durationSeconds"]
                    if args.max_seconds:
                        duration = min(duration, args.max_seconds)
                    if not math.isfinite(duration) or duration <= 0:
                        raise ValueError("Invalid duration")
                    if args.operation == "asr":
                        streams = [s["index"] for s in clip["streams"] if s["codec_type"] == "audio"]
                        if not streams:
                            entry.update(status="not_applicable", reason="no_audio")
                            report["clips"].append(entry)
                            continue
                        stream = args.audio_stream if args.audio_stream is not None else streams[0] if len(streams) == 1 else None
                        if stream not in streams:
                            raise ValueError("Select an explicit audio stream for multi-track media")
                        selected_stream = next(s for s in metadata["streams"] if s["index"] == stream)
                        offset = float(selected_stream.get("start_time", 0)) - float(metadata["format"].get("start_time", 0))
                        if abs(offset) > .001:
                            raise ValueError("Baseline ASR does not yet certify nonzero audio stream offset; needs timebase adapter")
                        prediction = transcribe(model, path, clip, profile, duration, stream)
                    else:
                        if not any(s["codec_type"] == "video" for s in clip["streams"]):
                            entry.update(status="not_applicable", reason="no_video")
                            report["clips"].append(entry)
                            continue
                        prediction = detect_scenes(path, profile, duration)
                    if digest(path) != clip["sha256"]:
                        raise ValueError("Source changed during inference")
                    elapsed = time.perf_counter() - started
                    prediction.update(version=VERSION, sourceHash=clip["sha256"], clipId=clip["id"])
                    filename = clip["id"] + ".json"
                    write(output / filename, prediction)
                    entry.update(status="completed", prediction=filename, predictionHash=digest(output / filename),
                                 elapsedSeconds=elapsed, durationSeconds=duration, rtf=elapsed/duration,
                                 firstInference=len(report["clips"]) == 0)
                except Exception as error:
                    entry.update(status="failed", error=str(error))
                report["clips"].append(entry)
                write(output / "report.json", report)
        report["memory"] = monitor.report()
        failed = any(c["status"] == "failed" for c in report["clips"])
        useful = any(c["status"] == "completed" for c in report["clips"])
        report["status"] = ("partial" if useful else "failed") if failed else "completed"
    except Exception as error:
        report.update(status="failed", error=str(error))
    finally:
        write(output / "report.json", report)
    return {"report": str(output / "report.json"), "status": report["status"], "clips": len(report["clips"]),
            "error": report.get("error"), "qualityStatus": "unscored"}


def validate_annotation(annotation, clip):
    if annotation.get("status") != "human_verified" or not str(annotation.get("reviewer") or "").strip():
        raise ValueError("Annotation has not been human verified")
    if annotation.get("sourceHash") != clip["sha256"] or annotation.get("version") != clip.get("annotationVersion"):
        raise ValueError("Annotation source/version mismatch")
    coverage = annotation.get("coverage")
    if not isinstance(coverage, list) or len(coverage) != 2 or any(not isinstance(t, (int, float)) or isinstance(t, bool) or not math.isfinite(t) for t in coverage):
        raise ValueError("Invalid annotation coverage")
    if not 0 <= coverage[0] < coverage[1] <= clip["durationSeconds"] + .001:
        raise ValueError("Annotation coverage outside source")
    if annotation.get("text") is not None and not isinstance(annotation["text"], str):
        raise ValueError("Gold text must be string or null (unlabelled)")
    if annotation.get("cuts") is not None:
        scene_metrics(annotation["cuts"], [])
        if any(not coverage[0] < t < coverage[1] for t in annotation["cuts"]):
            raise ValueError("Gold cuts outside coverage")
    previous = coverage[0]
    for segment in annotation.get("segments", []):
        left, right = segment["startSeconds"], segment["endSeconds"]
        if not all(isinstance(t, (int, float)) and math.isfinite(t) for t in [left, right]):
            raise ValueError("Non-finite gold segment")
        if not previous <= left < right <= coverage[1]:
            raise ValueError("Invalid/unsorted gold segment")
        previous = left
    return annotation


def audit(args):
    manifest = read(args.manifest)
    clips = manifest["clips"]
    if len({c["id"] for c in clips}) != len(clips):
        raise ValueError("Duplicate corpus IDs")
    blockers, annotated, labels = [], [], {}
    for clip in clips:
        try:
            source_path(manifest, clip)
            if not clip.get("annotation"):
                raise ValueError("Missing human annotation")
            annotation = validate_annotation(read(Path(args.manifest).parent / clip["annotation"]), clip)
            if annotation["coverage"] != [0, clip["durationSeconds"]]:
                raise ValueError("Full clip gold required for corpus qualification")
            if clip.get("split") not in ("development", "holdout") or not clip.get("sourceGroup") or not clip.get("speakerGroup"):
                raise ValueError("Missing split/source/speaker grouping")
            annotated.append(clip)
            labels[clip["id"]] = annotation
        except (ValueError, TypeError, KeyError, OSError) as error:
            blockers.append({"clip": clip["id"], "reason": str(error)})
    audio = [c for c in annotated if any(s["codec_type"] == "audio" for s in c["streams"]) and labels[c["id"]].get("text") is not None]
    duration = sum(c["durationSeconds"] for c in audio)
    if len(audio) < 36 or duration < 5400:
        blockers.append({"reason": "Need >=36 human-labelled audio clips and >=90 minutes"})
    for group, seconds in [("vi_clean", 1200), ("vi_hard", 1200), ("no_speech", 600)]:
        if sum(c["durationSeconds"] for c in audio if c.get("group") == group) < seconds:
            blockers.append({"reason": "Insufficient annotated group: " + group})
    tags = {tag for c in annotated for tag in c.get("tags", [])}
    required_tags = {"north", "central", "south", "english", "code_switch", "names_numbers", "noise_music",
                     "quiet_speech", "overlap", "conversation", "flash", "pan", "fade", "slides", "long_shot"}
    if required_tags - tags:
        blockers.append({"reason": "Missing verified diversity tags", "tags": sorted(required_tags-tags)})
    video = [c for c in annotated if any(t["codec_type"] == "video" for t in c["streams"]) and labels[c["id"]].get("cuts") is not None]
    cuts = sum(len(labels[c["id"]]["cuts"]) for c in video)
    if len(video) < 12 or cuts < 100:
        blockers.append({"reason": "Need >=12 scene-labelled clips and >=100 hard cuts"})
    boundaries = sum(2*len(labels[c["id"]].get("segments", [])) for c in audio)
    if boundaries < 300:
        blockers.append({"reason": "Need >=300 manually labelled speech boundaries"})
    for field in ("speakerGroup", "sourceGroup", "sha256"):
        development = {c[field] for c in annotated if c["split"] == "development"}
        holdout = {c[field] for c in annotated if c["split"] == "holdout"}
        if development & holdout:
            blockers.append({"reason": "Development/holdout leakage: " + field})
    fraction = sum(c["durationSeconds"] for c in audio if c["split"] == "holdout")/duration if duration else None
    if fraction is None or not .55 <= fraction <= .65:
        blockers.append({"reason": "Target 40/60 development/holdout by audio duration (55-65% holdout tolerance)"})
    return {"version": VERSION, "status": "blocked" if blockers else "ready_for_manual_corpus_review",
            "candidateClips": len(clips), "verifiedClips": len(annotated), "verifiedAudioSeconds": duration,
            "hardCuts": cuts, "speechBoundaries": boundaries, "holdoutDurationFraction": fraction,
            "blockers": blockers, "releaseAccepted": False}


def evidence_lock(manifest_path):
    manifest = read(manifest_path)
    return {"annotations": {c["id"]: digest(Path(manifest_path).parent / c["annotation"]) for c in manifest["clips"]},
            "models": digest(HERE / "models.lock.json"), "metrics": digest(HERE / "metrics.py"),
            "cpuDependencies": digest(HERE / "requirements-cpu.lock.txt"),
            "gpuDependencies": digest(HERE / "requirements-windows-gpu.lock.txt")}


def prepare_labels(args):
    manifest = read(args.manifest)
    destination = Path(args.output).resolve()
    if destination.exists():
        raise ValueError("Refusing to overwrite review corpus")
    labels = destination.parent / (destination.stem + "-labels")
    for clip in manifest["clips"]:
        path = labels / (clip["id"] + ".json")
        if path.exists():
            raise ValueError("Refusing to overwrite label: " + str(path))
    for clip in manifest["clips"]:
        path = labels / (clip["id"] + ".json")
        write(path, {"version": "1", "sourceHash": clip["sha256"], "status": "needs_human_review",
                     "reviewer": None, "coverage": [0, clip["durationSeconds"]],
                     "text": None, "segments": [], "cuts": None, "criticalTokens": [],
                     "notes": "Listen/watch original; null means unlabelled, empty text/cuts means verified absence. Never mark machine output as gold without review."})
        clip.update(annotation=path.relative_to(destination.parent).as_posix(), annotationVersion="1")
    write(destination, manifest)
    return {"manifest": str(destination), "labels": str(labels), "clips": len(manifest["clips"]), "status": "needs_human_review"}


def score(args):
    manifest = read(args.manifest)
    report = read(args.report)
    if any(c["id"] not in {e["id"] for e in manifest["clips"]} for c in report["clips"]):
        raise ValueError("Manifest missing benchmark clips")
    by_id = {c["id"]: c for c in manifest["clips"]}
    scores = []
    for entry in report["clips"]:
        row = {"id": entry["id"], "status": "unscored"}
        clip = by_id[entry["id"]]
        try:
            if entry["sourceHash"] != clip["sha256"] or entry["split"] != clip["split"]:
                raise ValueError("Source or split changed after inference")
            if entry["status"] != "completed":
                raise ValueError("Inference did not complete")
            annotation = validate_annotation(read(Path(args.manifest).parent / clip["annotation"]), clip)
            if annotation.get("status") != "human_verified" or not annotation.get("reviewer"):
                raise ValueError("Gold must be human verified")
            if annotation.get("sourceHash") != entry["sourceHash"] or annotation.get("version") != clip["annotationVersion"]:
                raise ValueError("Gold source/version mismatch")
            path = Path(args.report).parent / entry["prediction"]
            if digest(path) != entry["predictionHash"]:
                raise ValueError("Prediction checksum mismatch")
            prediction = read(path)
            if prediction["coverage"] != annotation["coverage"]:
                raise ValueError("Gold and prediction coverage differ")
            if report["operation"] == "asr":
                row["metrics"] = text_metrics(annotation["text"], prediction["text"])
                critical = annotation.get("criticalTokens", [])
                if any(not isinstance(t, str) or not normalize(t) or (" " + normalize(t) + " ") not in (" " + normalize(annotation["text"]) + " ") for t in critical):
                    raise ValueError("Critical phrase missing from gold text")
                matches = sum((" " + normalize(t) + " ") in (" " + normalize(prediction["text"]) + " ") for t in critical)
                row["criticalPhrases"] = {"matched": matches, "referenceCount": len(critical), "exactRecall": matches/len(critical) if critical else None}
                pairs = []
                segments = {s["id"]: s for s in prediction.get("segments", [])}
                for match in annotation.get("timingMatches", []):
                    if match["predictionHash"] != entry["predictionHash"]:
                        continue
                    segment = segments[match["segmentId"]]
                    pairs.append({"reference": [match["startSeconds"], match["endSeconds"]],
                                  "hypothesis": [segment["startSeconds"], segment["endSeconds"]]})
                row["timing"] = timing_metrics(pairs)
            else:
                row["metrics"] = scene_metrics(annotation["cuts"], prediction["cuts"])
            row["status"] = "scored"
            row["group"] = clip.get("group")
            row["tags"] = clip.get("tags", [])
            row["split"] = clip["split"]
            row["annotationHash"] = digest(Path(args.manifest).parent / clip["annotation"])
        except (ValueError, TypeError, KeyError, OSError) as error:
            row["reason"] = str(error)
        scores.append(row)
    aggregates = {}
    if report["operation"] == "asr":
        scored = [r for r in scores if r["status"] == "scored"]
        for group in {"all"} | {r["group"] for r in scored if r["group"]}:
            values = scored if group == "all" else [r for r in scored if r["group"] == group]
            aggregates[group] = {}
            for metric in ("rawCharacters", "characters", "whitespaceTokens"):
                edits = sum(r["metrics"][metric]["edits"] for r in values)
                count = sum(r["metrics"][metric]["referenceCount"] for r in values)
                aggregates[group][metric] = {"edits": edits, "referenceCount": count, "rate": edits/count if count else None}
    result = {"version": VERSION, "reportHash": digest(args.report), "scorerHash": digest(__file__),
              "metricsHash": digest(HERE / "metrics.py"), "clips": scores, "aggregates": aggregates,
              "releaseAccepted": False, "note": "Per-clip metrics only; corpus, timing, critical tokens and all release gates require review."}
    write(args.output, result)
    return result


def lock_holdout(args):
    result = audit(args)
    if result["blockers"]:
        raise ValueError("Corpus audit blocked; cannot lock holdout")
    if Path(args.output).exists():
        raise ValueError("Holdout lock exists; never overwrite after tuning")
    value = {"version": VERSION, "createdAt": time.time(), "manifestHash": digest(args.manifest),
             "profilesHash": digest(HERE / "profiles.json"), "reviewer": args.reviewer,
             "evidenceLock": evidence_lock(args.manifest)}
    write(args.output, value)
    return value


def configure_dlls():
    # Process-local paths from trusted venv. Never change system PATH or driver.
    if os.name != "nt":
        return []
    directories = []
    for module in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_nvrtc"):
        try:
            spec = importlib.util.find_spec(module)
            if spec and spec.submodule_search_locations:
                for location in spec.submodule_search_locations:
                    path = Path(location) / "bin"
                    if path.is_dir():
                        DLL_HANDLES.append(os.add_dll_directory(str(path)))
                        directories.append(str(path))
        except (ImportError, ModuleNotFoundError):
            pass
    if directories:
        os.environ["PATH"] = os.pathsep.join(directories + [os.environ.get("PATH", "")])
    return directories


def run(args):
    """Bound native inference; persist timeout/crash even when native code dies."""
    import psutil
    if not math.isfinite(args.timeout_seconds) or args.timeout_seconds <= 0:
        raise ValueError("timeout-seconds must be finite and positive")
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    output = LOCAL / "runs" / run_id
    output.mkdir(parents=True)
    report_path = output / "report.json"
    write(report_path, {"version": VERSION, "runId": run_id, "status": "starting", "clips": [],
                        "qualityStatus": "unscored"})
    argv = [sys.executable, "-I", str(Path(__file__).resolve()), "_run"] + sys.argv[2:] + ["--run-id", run_id]
    with (output / "worker.stdout.log").open("w", encoding="utf-8") as log:
        process = subprocess.Popen(argv, stdout=log, stderr=None,
                                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
        failure = None
        try:
            code = process.wait(timeout=args.timeout_seconds)
            if code:
                failure = "worker_exit_" + str(code)
        except (subprocess.TimeoutExpired, KeyboardInterrupt) as error:
            failure = "timeout" if isinstance(error, subprocess.TimeoutExpired) else "cancelled"
            try:
                tree = psutil.Process(process.pid)
                children = tree.children(recursive=True)
                for child in reversed(children):
                    try:
                        child.kill()
                    except psutil.NoSuchProcess:
                        pass
                tree.kill()
                psutil.wait_procs(children + [tree], timeout=5)
            except psutil.NoSuchProcess:
                pass
            process.wait(timeout=10)
    report = read(report_path)
    if failure:
        if report["status"] not in ("failed", "partial"):
            report["status"] = "failed"
        report["workerFailure"] = failure
    elif report["status"] not in ("completed", "partial", "failed"):
        report.update(status="failed", workerFailure="worker_did_not_finalize")
    report["timeoutSeconds"] = args.timeout_seconds
    report["workerStdout"] = "worker.stdout.log"
    write(report_path, report)
    return {"report": str(report_path), "status": report["status"], "clips": len(report["clips"]),
            "qualityStatus": "unscored", "workerFailure": report.get("workerFailure")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("doctor")
    p.set_defaults(function=doctor)
    p = sub.add_parser("inventory")
    p.add_argument("--source", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--provenance", default="Owner supplied for local evaluation")
    p.set_defaults(function=inventory)
    p = sub.add_parser("setup-model", help="Explicit online download, never uploads corpus")
    p.add_argument("--model", choices=["large-v3", "medium"], required=True)
    p.add_argument("--revision", help="Defaults to models.lock.json revision")
    p.set_defaults(function=setup_model)
    p = sub.add_parser("run", aliases=["_run"])
    p.add_argument("--manifest", required=True)
    p.add_argument("--operation", choices=["asr", "scenes"], required=True)
    p.add_argument("--profile", choices=list(read(HERE / "profiles.json")["profiles"]), default="large-v3-gpu-fp16")
    p.add_argument("--clip", action="append")
    p.add_argument("--max-seconds", type=float, help="Explicit prefix smoke; cannot count as full clip")
    p.add_argument("--audio-stream", type=int)
    p.add_argument("--holdout-lock")
    p.add_argument("--timeout-seconds", type=float, default=14400)
    p.add_argument("--run-id", help=argparse.SUPPRESS)
    p.set_defaults(function=run)
    p = sub.add_parser("audit")
    p.add_argument("--manifest", required=True)
    p.set_defaults(function=audit)
    p = sub.add_parser("prepare-labels")
    p.add_argument("--manifest", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(function=prepare_labels)
    p = sub.add_parser("score")
    p.add_argument("--manifest", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--output", required=True)
    p.set_defaults(function=score)
    p = sub.add_parser("lock-holdout")
    p.add_argument("--manifest", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--reviewer", required=True)
    p.set_defaults(function=lock_holdout)
    args = parser.parse_args()
    try:
        configure_dlls()
        result = run_worker(args) if args.command == "_run" else args.function(args)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False))
        return 2 if result.get("status") in ("failed", "partial", "blocked") else 0
    except Exception as error:
        print(json.dumps({"version": VERSION, "status": "failed", "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    raise SystemExit(main())
