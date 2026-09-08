"""Summarize verified baseline reports without inferring ASR quality from throughput."""
import argparse
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import evaluate as ev


def summarize(paths):
    rows = []
    for path in paths:
        path = Path(path).resolve()
        report = ev.read(path)
        completed = [c for c in report["clips"] if c["status"] == "completed"]
        for clip in completed:
            if ev.digest(path.parent / clip["prediction"]) != clip["predictionHash"]:
                raise ValueError("Prediction missing/tampered: " + clip["id"])
        duration = sum(c["durationSeconds"] for c in completed)
        elapsed = sum(c["elapsedSeconds"] for c in completed)
        warm = [c for c in completed if not c["firstInference"]]
        warm_duration = sum(c["durationSeconds"] for c in warm)
        rows.append({"runId": report["runId"], "reportHash": ev.digest(path), "operation": report["operation"],
                     "profileId": report["profileId"], "profile": report["profile"], "status": report["status"],
                     "scope": report["scope"], "completed": len(completed), "requested": len(report.get("requestedClipIds", report["clips"])),
                     "mediaSeconds": duration, "processingSeconds": elapsed,
                     "rtf": elapsed/duration if duration else None,
                     "warmRtf": sum(c["elapsedSeconds"] for c in warm)/warm_duration if warm_duration else None,
                     "modelLoadSeconds": report["modelLoadSeconds"], "memory": report.get("memory"),
                     "selectionFingerprint": ev.fingerprint(sorted((c["id"], c["sourceHash"], c["durationSeconds"]) for c in completed)),
                     "predictionsVerified": True, "qualityStatus": "unscored"})
    asr = [r for r in rows if r["operation"] == "asr"]
    return {"version": "1.0", "runs": rows,
            "sameAsrInputCoverage": len({r["selectionFingerprint"] for r in asr}) == 1 if asr else None,
            "releaseDefault": None, "releaseAccepted": False,
            "note": "Desktop baseline, not controlled performance or human quality certification. First inference excluded from warm RTF. GPU memory is device-wide sampled peak."}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = summarize(args.reports)
    ev.write(args.output, result)
    print(__import__("json").dumps(result))
