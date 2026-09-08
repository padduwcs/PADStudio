"""Generate deterministic fixtures, run real tools, assert invariants (not ASR quality)."""
import json
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate as ev


def main():
    root = ev.LOCAL / "synthetic"
    root.mkdir(parents=True, exist_ok=True)
    ffmpeg = os.environ.get("PADSTUDIO_FFMPEG_PATH", "ffmpeg")
    for name, source in [("silence", "anullsrc=r=16000:cl=mono"), ("tone", "sine=frequency=440:sample_rate=16000")]:
        ev.command([ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", source,
                    "-t", "6", root / (name + ".wav")])
    ev.command([ffmpeg, "-v", "error", "-nostdin", "-y", "-f", "lavfi", "-i", "color=black:s=160x90:r=30:d=2",
                "-f", "lavfi", "-i", "color=white:s=160x90:r=30:d=2", "-f", "lavfi", "-i", "color=red:s=160x90:r=30:d=2",
                "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264",
                "-pix_fmt", "yuv420p", root / "hard-cuts.mp4"])
    # New manifest per smoke; keep previous runs and manifests intact.
    import argparse
    manifest = root / ("corpus-" + ev.uuid.uuid4().hex[:8] + ".json")
    ev.inventory(argparse.Namespace(source=root, output=manifest, provenance="Generated deterministic smoke fixtures, not human corpus"))
    results = []
    for operation in ("scenes", "asr"):
        args = [sys.executable, "-I", str(ev.HERE / "evaluate.py"), "run", "--manifest", str(manifest),
                "--operation", operation, "--profile", "large-v3-cpu-int8", "--timeout-seconds", "300"]
        output = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=330)
        if output.returncode:
            raise RuntimeError(output.stdout + output.stderr)
        report = ev.read(json.loads(output.stdout)["report"])
        report_path = Path(json.loads(output.stdout)["report"])
        for entry in report["clips"]:
            if entry["status"] == "not_applicable":
                continue
            prediction = ev.read(report_path.parent / entry["prediction"])
            if operation == "asr":
                if prediction["text"]:
                    raise AssertionError("False speech on silence/tone: " + prediction["text"])
            else:
                match = ev.scene_metrics([2., 4.], prediction["cuts"])
                if match["matched"] != 2 or match["predictedCount"] != 2:
                    raise AssertionError("Synthetic hard cuts mismatch: " + str(match))
        results.append({"operation": operation, "report": str(report_path), "status": "passed"})
    # Actual worker deadline. No broad process termination; coordinator kills its own tree.
    output = subprocess.run([sys.executable, "-I", str(ev.HERE / "evaluate.py"), "run", "--manifest", str(manifest),
                             "--operation", "scenes", "--timeout-seconds", ".01"],
                            capture_output=True, text=True, encoding="utf-8", timeout=20)
    timeout_result = json.loads(output.stdout)
    if output.returncode != 2 or timeout_result.get("workerFailure") != "timeout":
        raise AssertionError("Timeout was not persisted: " + output.stdout)
    result = {"version": "1.0", "status": "passed", "results": results, "timeout": timeout_result,
              "scope": "synthetic invariants only; not human ASR/scene release quality"}
    ev.write(root / "smoke-report.json", result)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
