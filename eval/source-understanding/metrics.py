"""Dependency-free, versioned metrics. Machine predictions are never gold labels."""
import math
import unicodedata

NORMALIZATION_VERSION = "nfc-lower-preserve-numbers-v1"


def normalize(text):
    # Keep Vietnamese diacritics and digits. No inferred spoken-number conversion.
    text = unicodedata.normalize("NFC", text).lower()
    output = []
    for index, char in enumerate(text):
        before = text[index-1] if index else " "
        after = text[index+1] if index+1 < len(text) else " "
        numeric = (char in ".,:/" and before.isdigit() and after.isdigit()) or (char in "+-" and after.isdigit())
        output.append(char if numeric or unicodedata.category(char)[0] not in "PZ" else " ")
    return " ".join("".join(output).split())


def distance(reference, hypothesis):
    previous = list(range(len(hypothesis) + 1))
    for i, left in enumerate(reference, 1):
        current = [i]
        for j, right in enumerate(hypothesis, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (left != right)))
        previous = current
    return previous[-1]


def text_metrics(reference, hypothesis):
    def measure(left, right):
        edits = distance(left, right)
        return {"edits": edits, "referenceCount": len(left),
                "rate": edits / len(left) if left else None}
    return {
        "normalizationVersion": NORMALIZATION_VERSION,
        "rawCharacters": measure(reference, hypothesis),
        "characters": measure(normalize(reference), normalize(hypothesis)),
        "whitespaceTokens": measure(normalize(reference).split(), normalize(hypothesis).split()),
        "falseSpeechTokens": len(normalize(hypothesis).split()) if not normalize(reference) else None,
    }


def scene_metrics(reference, hypothesis, tolerance=0.2):
    """Maximum one-to-one matching of sorted cuts within inclusive tolerance."""
    if not math.isfinite(tolerance) or tolerance < 0:
        raise ValueError("Invalid tolerance")
    for values in (reference, hypothesis):
        if any(not isinstance(t, (int, float)) or isinstance(t, bool) or
               not math.isfinite(t) or t < 0 for t in values):
            raise ValueError("Invalid cut timestamp")
        if len(set(values)) != len(values):
            raise ValueError("Duplicate cut timestamp")
    gold, predicted = sorted(reference), sorted(hypothesis)
    i = j = 0
    errors = []
    while i < len(gold) and j < len(predicted):
        delta = predicted[j] - gold[i]
        if abs(delta) <= tolerance + 1e-9:
            errors.append(abs(delta))
            i += 1
            j += 1
        elif delta < 0:
            j += 1
        else:
            i += 1
    return {"matched": len(errors), "referenceCount": len(gold), "predictedCount": len(predicted),
            "precision": len(errors) / len(predicted) if predicted else None,
            "recall": len(errors) / len(gold) if gold else None,
            "absoluteErrorsSeconds": errors, "toleranceSeconds": tolerance}


def percentile95(values):
    return sorted(values)[max(0, math.ceil(len(values) * .95) - 1)] if values else None


def timing_metrics(pairs):
    # Explicit human matching avoids silently aligning unrelated segments by index.
    errors = []
    for pair in pairs:
        for key in ("reference", "hypothesis"):
            if len(pair[key]) != 2 or any(not math.isfinite(v) or v < 0 for v in pair[key]):
                raise ValueError("Invalid timing pair")
            if pair[key][0] >= pair[key][1]:
                raise ValueError("Invalid interval")
        errors.extend(abs(a - b) for a, b in zip(pair["reference"], pair["hypothesis"]))
    return {"boundaryCount": len(errors), "absoluteErrorsSeconds": errors,
            "p95Seconds": percentile95(errors)}
