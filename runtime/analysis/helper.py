"""PADStudio production helper for scene detection and local ASR.

The Node adapter owns project resolution and commits outputs.  This helper only
reads the resolved media path and writes datasets into the temporary workspace
that the adapter supplies.  Requests arrive as one JSON object on stdin and the
only stdout value is one bounded JSON response.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import wave


PROTOCOL_VERSION = "1.0"
HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
DEFAULT_MODEL_ROOT = REPO / ".cache" / "source-eval" / "models"
DLL_HANDLES = []
PACKAGE_LOCK = {
    "faster-whisper": "1.2.1",
    "ctranslate2": "4.8.2",
    "scenedetect": "0.7.1",
    "av": "18.1.0",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def finite(value):
    if value is None:
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def configure_streams():
    """Read the request and write the response as UTF-8, whatever the console code page is.

    The Node adapter sends UTF-8. On Windows a piped stdin is decoded with the ANSI code page instead, so every
    accented letter of a Vietnamese glossary or path became mojibake, and a byte the code page leaves undefined
    (0x9D in "ờ") became a lone surrogate that the tokenizer rejects with "TextInputSequence must be str".
    """
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def require_request(command: str):
    value = json.load(sys.stdin)
    if not isinstance(value, dict) or value.get("protocolVersion") != PROTOCOL_VERSION:
        raise ValueError("Invalid helper protocol request")
    if value.get("command") != command:
        raise ValueError("Helper command does not match request")
    input_path = Path(value["inputPath"]).resolve(strict=True)
    if not input_path.is_file():
        raise ValueError("Resolved input is not a file")
    output_path = Path(value["outputPath"]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.exists():
        raise ValueError("Refusing to overwrite helper output")
    value["inputPath"] = input_path
    value["outputPath"] = output_path
    return value


def configure_dlls():
    if os.name != "nt":
        return []
    directories = []
    for module in ("nvidia.cublas", "nvidia.cudnn", "nvidia.cuda_nvrtc"):
        try:
            spec = importlib.util.find_spec(module)
            if spec and spec.submodule_search_locations:
                for location in spec.submodule_search_locations:
                    directory = Path(location) / "bin"
                    if directory.is_dir():
                        DLL_HANDLES.append(os.add_dll_directory(str(directory)))
                        directories.append(str(directory))
        except (ImportError, ModuleNotFoundError):
            pass
    if directories:
        os.environ["PATH"] = os.pathsep.join(directories + [os.environ.get("PATH", "")])
    return directories


def package_versions():
    result = {}
    for name in PACKAGE_LOCK:
        try:
            result[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            result[name] = None
    return result


def load_profiles(path=None):
    document = read_json(Path(path or HERE / "profiles.json"))
    if document.get("version") != PROTOCOL_VERSION or not isinstance(document.get("profiles"), dict):
        raise ValueError("Invalid production profile manifest")
    return document


def profile(profile_id: str, path=None):
    profiles = load_profiles(path)
    value = profiles["profiles"].get(profile_id)
    if not isinstance(value, dict):
        raise ValueError("Unknown production profile: " + str(profile_id))
    return value


def object_digest(value) -> str:
    encoded = json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verified_model(model_name: str, model_root: Path, lock_path: Path, full: bool):
    lock = read_json(lock_path)["models"][model_name]
    directory = (model_root / model_name).resolve(strict=True)
    manifest = read_json(directory / "model-manifest.json")
    if manifest.get("model") != model_name or manifest.get("revision") != lock["revision"]:
        raise ValueError("Local model revision differs from production lock")
    if manifest.get("files") != lock["files"]:
        raise ValueError("Local model manifest differs from production lock")
    for relative, expected in lock["files"].items():
        path = (directory / relative).resolve(strict=True)
        if not path.is_relative_to(directory) or not path.is_file():
            raise ValueError("Unsafe or missing model file: " + relative)
        if full and sha256_file(path) != expected:
            raise ValueError("Model integrity mismatch: " + relative)
    return directory, lock


def doctor(args):
    configure_dlls()
    versions = package_versions()
    required = ("scenedetect", "av") if args.kind == "scenes" else ("faster-whisper", "ctranslate2")
    blockers = [
        {"component": name, "reason": "expected " + expected + ", found " + str(versions[name])}
        for name, expected in PACKAGE_LOCK.items() if name in required and versions[name] != expected
    ]
    response = {
        "protocolVersion": PROTOCOL_VERSION,
        "python": sys.version.split()[0],
        "packages": versions,
        "profileId": args.profile,
        "available": False,
        "blockers": blockers,
    }
    try:
        selected = profile(args.profile, args.profiles)
        response["profile"] = selected
        response["profileDigest"] = object_digest({"profileId": args.profile, "profile": selected})
        if args.kind == "scenes":
            if versions["scenedetect"] != PACKAGE_LOCK["scenedetect"] or versions["av"] != PACKAGE_LOCK["av"]:
                raise ValueError("Scene dependency lock mismatch")
        elif args.kind == "asr":
            if versions["faster-whisper"] != PACKAGE_LOCK["faster-whisper"] or versions["ctranslate2"] != PACKAGE_LOCK["ctranslate2"]:
                raise ValueError("ASR dependency lock mismatch")
            model_root = Path(args.model_root or os.environ.get("PADSTUDIO_ANALYSIS_MODEL_DIR") or DEFAULT_MODEL_ROOT)
            _, lock = verified_model(selected["model"], model_root, Path(args.models_lock), False)
            response.update(
                modelRevision=lock["revision"],
                modelLockDigest=object_digest(lock),
                device=selected["device"],
                computeType=selected["computeType"],
            )
            import ctranslate2
            supported = sorted(ctranslate2.get_supported_compute_types(selected["device"]))
            response["supportedComputeTypes"] = supported
            if selected["computeType"] not in supported:
                raise ValueError("Requested compute type is not supported by this device")
        response["available"] = not blockers
    except Exception as error:
        response["blockers"].append({"component": args.kind, "reason": str(error)})
    response["available"] = len(response["blockers"]) == 0
    return response


def scene_score(stats_manager, frame_number: int, window_width: int):
    candidates = [
        "adaptive_ratio (w=" + str(window_width) + ")",
        "adaptive_ratio",
        "content_val",
    ]
    try:
        metrics = stats_manager.get_metrics(frame_number, candidates)
        for _key, metric in zip(candidates, metrics):
            value = finite(metric)
            if value is not None:
                return value
    except Exception:
        pass
    return None


def scenes(_args):
    request = require_request("scenes")
    base_profile = profile(request["profileId"], request.get("profilesPath"))
    overrides = request.get("detectorOptions") or {}
    if not isinstance(overrides, dict):
        raise ValueError("detectorOptions must be an object")
    selected = {**base_profile, **overrides}
    from scenedetect import FrameTimecode, SceneManager, StatsManager, open_video
    from scenedetect.detectors import AdaptiveDetector

    video = open_video(str(request["inputPath"]), backend="pyav")
    stats = StatsManager()
    manager = SceneManager(stats_manager=stats)
    manager.add_detector(AdaptiveDetector(
        adaptive_threshold=float(selected["adaptiveThreshold"]),
        min_scene_len=int(selected["minSceneLengthFrames"]),
        window_width=int(selected["windowWidth"]),
        min_content_val=float(selected["minContentValue"]),
    ))
    start_seconds = float(request["range"]["startSeconds"])
    end_seconds = float(request["range"]["endSeconds"])
    if start_seconds > 0:
        video.seek(FrameTimecode(timecode=start_seconds, fps=video.frame_rate))
    processed_frames = manager.detect_scenes(
        video=video,
        end_time=FrameTimecode(timecode=end_seconds, fps=video.frame_rate),
        show_progress=False,
    )
    processed_end = start_seconds + float(processed_frames) / float(video.frame_rate)
    coverage_tolerance = max(0.1, 2.0 / float(video.frame_rate))
    if processed_end < end_seconds - coverage_tolerance:
        raise ValueError("Scene decode ended before requested coverage")
    detected = manager.get_scene_list(start_in_scene=True)
    boundaries = [start_seconds]
    for start, _end in detected:
        value = max(start_seconds, min(end_seconds, start.seconds))
        if start_seconds + 1e-6 < value < end_seconds - 1e-6:
            boundaries.append(value)
    boundaries.append(end_seconds)
    boundaries = sorted(set(round(value, 9) for value in boundaries))
    rows = []
    for index, (left, right) in enumerate(zip(boundaries, boundaries[1:])):
        if right <= left:
            continue
        frame_number = round(left * video.frame_rate)
        rows.append({
            "id": "shot-" + str(index + 1).zfill(5),
            "startSeconds": left,
            "endSeconds": right,
            "boundaryKind": "range_start" if index == 0 else "hard_cut",
            "score": None if index == 0 else scene_score(stats, frame_number, int(selected["windowWidth"])),
            "method": {
                "detector": "AdaptiveDetector",
                "profileId": request["profileId"],
            },
        })
    if not rows:
        raise ValueError("Scene detector produced no continuous shot range")
    previous = start_seconds
    for row in rows:
        if abs(row["startSeconds"] - previous) > 0.001 or not row["startSeconds"] < row["endSeconds"] <= end_seconds + 0.001:
            raise ValueError("Scene output is not continuous inside requested range")
        previous = row["endSeconds"]
    if abs(previous - end_seconds) > 0.001:
        raise ValueError("Scene output does not cover requested range")
    with request["outputPath"].open("x", encoding="utf-8", newline="\n") as stream:
        for row in rows:
            stream.write(json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "profileDigest": object_digest({"profileId": request["profileId"], "profile": base_profile}),
        "counts": {"scenes": len(rows), "cuts": max(0, len(rows) - 1)},
        "warnings": [{
            "code": "scene_semantics_not_inferred",
            "message": "AdaptiveDetector boundaries are visual shot candidates, not semantic sections; fades may be missed.",
        }],
        "coverage": request["range"],
    }


def ffmpeg_decode(ffmpeg: str, input_path: Path, output_path: Path, audio_stream: int, left: float, right: float):
    command = [
        ffmpeg, "-hide_banner", "-v", "error", "-nostdin", "-y",
        "-protocol_whitelist", "file,pipe", "-ss", str(left), "-i", str(input_path),
        "-t", str(right - left), "-map", "0:" + str(audio_stream), "-vn", "-ac", "1", "-ar", "16000", str(output_path),
    ]
    completed = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace",
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if completed.returncode:
        raise ValueError("FFmpeg audio decode failed: " + completed.stderr[-1000:])
    with wave.open(str(output_path), "rb") as stream:
        decoded_seconds = stream.getnframes() / stream.getframerate()
    if decoded_seconds < (right - left) - 0.05:
        raise ValueError("FFmpeg audio decode ended before requested chunk coverage")


def asr(_args):
    request = require_request("transcribe")
    configure_dlls()
    selected = profile(request["profileId"], request.get("profilesPath"))
    model_root = Path(request.get("modelRoot") or os.environ.get("PADSTUDIO_ANALYSIS_MODEL_DIR") or DEFAULT_MODEL_ROOT)
    model_directory, lock = verified_model(selected["model"], model_root, Path(request["modelsLockPath"]), True)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    from faster_whisper import WhisperModel

    started_load = time.perf_counter()
    model = WhisperModel(str(model_directory), device=selected["device"], compute_type=selected["computeType"], local_files_only=True)
    load_seconds = time.perf_counter() - started_load
    start_seconds = float(request["range"]["startSeconds"])
    end_seconds = float(request["range"]["endSeconds"])
    ownership = start_seconds
    segment_index = 0
    word_index = 0
    chunk_index = 0
    warnings = []
    chunks = []
    language_override = request.get("language")
    if language_override == "auto":
        language_override = None
    glossary = request.get("glossary") or []
    initial_prompt = ", ".join(glossary) if glossary else None
    ffmpeg = request.get("ffmpegCommand") or os.environ.get("PADSTUDIO_FFMPEG_PATH", "ffmpeg")
    temporary_wav = request["outputPath"].with_suffix(".window.wav")
    with request["outputPath"].open("x", encoding="utf-8", newline="\n") as output:
        while ownership < end_seconds - 1e-9:
            owned_end = min(end_seconds, ownership + float(selected["chunkSeconds"]))
            left = max(start_seconds, ownership - float(selected["overlapSeconds"]))
            right = min(end_seconds, owned_end + float(selected["overlapSeconds"]))
            temporary_wav.unlink(missing_ok=True)
            ffmpeg_decode(ffmpeg, request["inputPath"], temporary_wav, int(request["audioStream"]), left, right)
            started = time.perf_counter()
            segments, info = model.transcribe(
                str(temporary_wav),
                language=language_override,
                beam_size=int(selected["beamSize"]),
                word_timestamps=True,
                vad_filter=bool(selected["vad"]),
                vad_parameters={"min_silence_duration_ms": int(selected["vadMinimumSilenceMs"])},
                condition_on_previous_text=False,
                temperature=float(selected["temperature"]),
                initial_prompt=initial_prompt,
            )
            chunk_rows = 0
            for segment in segments:
                diagnostic = {
                    "avgLogprob": finite(getattr(segment, "avg_logprob", None)),
                    "compressionRatio": finite(getattr(segment, "compression_ratio", None)),
                    "noSpeechProbability": finite(getattr(segment, "no_speech_prob", None)),
                    "chunk": chunk_index,
                }
                words = []
                for word in segment.words or []:
                    word_start = left + float(word.start)
                    word_end = left + float(word.end)
                    midpoint = (word_start + word_end) / 2
                    if ownership <= midpoint < owned_end:
                        word_index += 1
                        words.append({
                            "id": "word-" + str(word_index).zfill(7),
                            "text": word.word,
                            "startSeconds": word_start,
                            "endSeconds": word_end,
                            "score": finite(word.probability),
                        })
                row = None
                if words:
                    row = {
                        "id": "segment-" + str(segment_index + 1).zfill(6),
                        "startSeconds": words[0]["startSeconds"],
                        "endSeconds": words[-1]["endSeconds"],
                        "text": "".join(word["text"] for word in words).strip(),
                        "language": info.language,
                        "words": words,
                        "diagnostics": diagnostic,
                    }
                elif not segment.words:
                    midpoint = left + (float(segment.start) + float(segment.end)) / 2
                    if ownership <= midpoint < owned_end and str(segment.text).strip():
                        row = {
                            "id": "segment-" + str(segment_index + 1).zfill(6),
                            "startSeconds": None,
                            "endSeconds": None,
                            "text": str(segment.text).strip(),
                            "language": info.language,
                            "words": [],
                            "diagnostics": {**diagnostic, "timing": "unaligned"},
                        }
                        if "unaligned_segments" not in warnings:
                            warnings.append("unaligned_segments")
                if row:
                    segment_index += 1
                    chunk_rows += 1
                    output.write(json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n")
            chunks.append({
                "index": chunk_index,
                "ownership": {"startSeconds": ownership, "endSeconds": owned_end},
                "decodeRange": {"startSeconds": left, "endSeconds": right},
                "inferenceSeconds": time.perf_counter() - started,
                "language": info.language,
                "languageProbability": finite(info.language_probability),
                "segments": chunk_rows,
            })
            ownership = owned_end
            chunk_index += 1
    temporary_wav.unlink(missing_ok=True)
    if not segment_index:
        warnings.append("no_speech_is_model_outcome")
    return {
        "protocolVersion": PROTOCOL_VERSION,
        "modelRevision": lock["revision"],
        "modelLockDigest": object_digest(lock),
        "profileDigest": object_digest({"profileId": request["profileId"], "profile": selected}),
        "device": selected["device"],
        "computeType": selected["computeType"],
        "loadSeconds": load_seconds,
        "coverage": request["range"],
        "counts": {"segments": segment_index, "words": word_index, "chunks": len(chunks)},
        "chunks": chunks,
        "decoding": {
            "languageRequested": request.get("language"),
            "beamSize": int(selected["beamSize"]),
            "wordTimestamps": True,
            "vad": bool(selected["vad"]),
            "vadMinimumSilenceMs": int(selected["vadMinimumSilenceMs"]),
            "chunkSeconds": float(selected["chunkSeconds"]),
            "overlapSeconds": float(selected["overlapSeconds"]),
            "conditionOnPreviousText": False,
            "temperature": float(selected["temperature"]),
        },
        "warnings": warnings,
        "outcome": "produced" if segment_index else "empty",
        "emptyReason": None if segment_index else "no_speech_detected",
        "glossaryVersion": request.get("glossaryVersion"),
    }


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    doctor_parser = sub.add_parser("doctor")
    doctor_parser.add_argument("--kind", choices=["scenes", "asr"], required=True)
    doctor_parser.add_argument("--profile", required=True)
    doctor_parser.add_argument("--profiles", default=str(HERE / "profiles.json"))
    doctor_parser.add_argument("--models-lock", default=str(HERE / "models.lock.json"))
    doctor_parser.add_argument("--model-root")
    sub.add_parser("scenes")
    sub.add_parser("transcribe")
    args = parser.parse_args()
    if args.command == "doctor":
        result = doctor(args)
    elif args.command == "scenes":
        result = scenes(args)
    else:
        result = asr(args)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    configure_streams()
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"protocolVersion": PROTOCOL_VERSION, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
