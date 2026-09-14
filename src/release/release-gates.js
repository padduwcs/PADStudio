const iso = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const text = (value) => typeof value === "string" && value.trim().length > 0;
const refs = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);

const issue = (code, message) => ({ code, message });

function baseIssues(measurement) {
  const issues = [];
  if (!measurement || typeof measurement !== "object" || Array.isArray(measurement)) {
    return [issue("invalid_measurement", "Evidence entry must be an object.")];
  }
  if (!["passed", "failed"].includes(measurement.outcome)) {
    issues.push(issue("invalid_outcome", "outcome must be passed or failed; callers cannot submit not_measured as evidence."));
  }
  if (!iso(measurement.measuredAt)) issues.push(issue("missing_measured_at", "measuredAt must be an ISO date-time."));
  if (!text(measurement.method)) issues.push(issue("missing_method", "A reproducible method is required."));
  if (!refs(measurement.evidenceRefs)) issues.push(issue("missing_evidence_refs", "At least one durable evidence reference is required."));
  return issues;
}

function corpusIssues(measurement, corpora) {
  if (!text(measurement.corpusId)) return [issue("missing_corpus", "corpusId is required for corpus evidence.")];
  const corpus = corpora.get(measurement.corpusId);
  if (!corpus) return [issue("unknown_corpus", `Corpus ${measurement.corpusId} is not declared.`)];
  return corpus.rightsConfirmed === true ? []
    : [issue("corpus_rights_unconfirmed", "Corpus rights must be confirmed before release evidence can use it.")];
}

function holdoutIssues(measurement, corpora, knownIds) {
  const issues = corpusIssues(measurement, corpora);
  const corpus = corpora.get(measurement.corpusId);
  if (!corpus) return issues;
  if (knownIds.has(corpus.id) || corpus.knownDevelopment !== false || corpus.classification !== "holdout") {
    issues.push(issue("not_independent_holdout", "Known development data cannot satisfy the independent holdout gate."));
  }
  if (corpus.lockedBeforeEvaluation !== true) issues.push(issue("holdout_not_locked", "Holdout must be locked before evaluation."));
  if (!sha256(corpus.manifestSha256)) issues.push(issue("missing_manifest_checksum", "Holdout manifestSha256 is required."));
  const characteristics = corpus.characteristics;
  const required = ["audioMinutes", "clipCount", "cleanVietnameseMinutes", "hardVietnameseMinutes",
    "noSpeechMinutes", "timingBoundaryCount", "sceneClipCount", "hardCutCount"];
  if (!characteristics || required.some((name) => !Number.isFinite(characteristics[name]))) {
    issues.push(issue("missing_holdout_characteristics", `Holdout must report finite characteristics: ${required.join(", ")}.`));
  } else if (characteristics.audioMinutes < 90
    || !Number.isInteger(characteristics.clipCount) || characteristics.clipCount < 36
    || characteristics.cleanVietnameseMinutes < 20 || characteristics.hardVietnameseMinutes < 20
    || characteristics.noSpeechMinutes < 10
    || !Number.isInteger(characteristics.timingBoundaryCount) || characteristics.timingBoundaryCount < 300
    || !Number.isInteger(characteristics.sceneClipCount) || characteristics.sceneClipCount < 12
    || !Number.isInteger(characteristics.hardCutCount) || characteristics.hardCutCount < 100) {
    issues.push(issue("holdout_characteristics_failed", "Holdout does not satisfy the minimum corpus characteristics in SOURCE-UNDERSTANDING-SPEC section 13.1."));
  }
  if (characteristics?.splitBySpeakerAndSource !== true || characteristics?.humanVerifiedGold !== true) {
    issues.push(issue("holdout_gold_not_verified", "Holdout must be split by speaker/source and use human-verified gold annotations."));
  }
  return issues;
}

function metrics(measurement, names) {
  if (!measurement.metrics || typeof measurement.metrics !== "object" || Array.isArray(measurement.metrics)) return [issue("missing_metrics", "This evidence must contain measured metrics.")];
  const missing = names.filter((name) => !Number.isFinite(measurement.metrics[name]));
  return missing.length ? [issue("missing_metrics", `Missing finite metrics: ${missing.join(", ")}.`)] : [];
}

function qualityIssues(gate, measurement) {
  const contracts = {
    asr_cer_and_timing_thresholds: {
      names: ["cleanCer", "cleanTokenError", "hardCer", "hardTokenError", "cleanCriticalContentAccuracy", "timingBoundaryP95Seconds"],
      passes: (m) => m.cleanCer >= 0 && m.cleanCer <= 0.05 && m.cleanTokenError >= 0 && m.cleanTokenError <= 0.12
        && m.hardCer >= 0 && m.hardCer <= 0.12 && m.hardTokenError >= 0 && m.hardTokenError <= 0.25
        && m.cleanCriticalContentAccuracy >= 0.9 && m.cleanCriticalContentAccuracy <= 1
        && m.timingBoundaryP95Seconds >= 0 && m.timingBoundaryP95Seconds <= 0.5
    },
    scene_precision_recall: {
      names: ["precision", "recall", "toleranceSeconds"],
      passes: (m) => m.precision >= 0.9 && m.precision <= 1 && m.recall >= 0.9 && m.recall <= 1
        && m.toleranceSeconds >= 0 && m.toleranceSeconds <= 0.2
    },
    hundred_file_ten_hour_query_benchmark: {
      names: ["files", "transcriptHours", "warmQueryP95Ms", "summaryP95Ms", "peakMemoryBytes"],
      passes: (m) => Number.isInteger(m.files) && m.files >= 100 && m.transcriptHours >= 10
        && m.warmQueryP95Ms >= 0 && m.warmQueryP95Ms <= 500 && m.summaryP95Ms >= 0 && m.summaryP95Ms <= 1000
        && m.peakMemoryBytes > 0 && m.peakMemoryBytes <= 16 * 1024 ** 3
    }
  };
  const contract = contracts[gate.id];
  if (!contract) return [issue("missing_quality_contract", `No metric contract exists for ${gate.id}.`)];
  const missing = metrics(measurement, contract.names);
  if (missing.length || measurement.outcome !== "passed" || contract.passes(measurement.metrics)) return missing;
  return [issue("metric_threshold_failed", "Submitted passed outcome contradicts the release thresholds in SOURCE-UNDERSTANDING-SPEC section 13.")];
}

function corpusSlotIssues(gate, measurement) {
  const contracts = {
    landscape_source: { names: ["width", "height", "endToEndCompleted"], passes: (m) => m.width > m.height && m.height > 0 && m.endToEndCompleted === 1 },
    vfr_source: { names: ["averageFrameRate", "nominalFrameRate", "endToEndCompleted"], passes: (m) => m.averageFrameRate > 0 && m.nominalFrameRate > 0 && Math.abs(m.averageFrameRate - m.nominalFrameRate) > 0.001 && m.endToEndCompleted === 1 },
    four_k_source: { names: ["width", "height", "endToEndCompleted"], passes: (m) => m.width > 0 && m.height > 0 && (m.width >= 3840 || m.height >= 2160) && m.endToEndCompleted === 1 },
    audio_only_source: { names: ["audioTracks", "videoTracks", "endToEndCompleted"], passes: (m) => Number.isInteger(m.audioTracks) && m.audioTracks >= 1 && m.videoTracks === 0 && m.endToEndCompleted === 1 },
    image_only_source: { names: ["imageCount", "videoTracks", "endToEndCompleted"], passes: (m) => Number.isInteger(m.imageCount) && m.imageCount >= 1 && m.videoTracks === 0 && m.endToEndCompleted === 1 },
    multitrack_source: { names: ["audioTracks", "videoTracks", "explicitSelections", "endToEndCompleted"], passes: (m) => (m.audioTracks >= 2 || m.videoTracks >= 2) && m.explicitSelections >= 1 && m.endToEndCompleted === 1 },
    two_hour_source: { names: ["durationSeconds", "endToEndCompleted"], passes: (m) => m.durationSeconds >= 7200 && m.endToEndCompleted === 1 },
    nonzero_stream_offset_source: { names: ["absoluteStreamOffsetSeconds", "endToEndCompleted"], passes: (m) => m.absoluteStreamOffsetSeconds > 0 && m.endToEndCompleted === 1 },
    corrupt_source_failure: { names: ["explicitFailures", "committedResults", "failureWasExplicit"], passes: (m) => m.explicitFailures >= 1 && m.committedResults === 0 && m.failureWasExplicit === 1 }
  };
  const contract = contracts[gate.id];
  if (!contract) return [issue("missing_corpus_contract", `No media-slot contract exists for ${gate.id}.`)];
  const missing = metrics(measurement, contract.names);
  if (missing.length || measurement.outcome !== "passed" || contract.passes(measurement.metrics)) return missing;
  return [issue("media_slot_requirement_failed", `Submitted passed outcome does not satisfy ${gate.id}.`)];
}

function humanIssues(gate, measurement) {
  const issues = [];
  if (measurement.reviewer?.kind !== "human" || !text(measurement.reviewer?.id)) {
    issues.push(issue("missing_human_reviewer", "Human review requires reviewer.kind=human and a reviewer id."));
  }
  if (!text(measurement.resultId)) issues.push(issue("missing_exact_result", "Human review must identify the exact Result."));
  if (!sha256(measurement.resultSha256)) issues.push(issue("missing_exact_checksum", "Human review must bind the exact Result SHA-256."));
  if (!text(measurement.artifactId) || !Number.isInteger(measurement.artifactRevision) || measurement.artifactRevision < 1) {
    issues.push(issue("missing_exact_revision", "Human review must identify the exact artifact revision."));
  }
  const action = gate.id === "human_viewing_review" ? "viewed" : "listened";
  if (measurement.attestation?.action !== action || measurement.attestation?.completedEntireResult !== true) {
    issues.push(issue("incomplete_human_attestation",
      `Human review must explicitly attest that the exact Result was ${action} in full.`));
  }
  return issues;
}

function deliveryIssues(measurement) {
  const issues = [];
  if (!text(measurement.resultId) || !text(measurement.profileId)) {
    issues.push(issue("missing_delivery_target", "Delivery review requires an exact Result and output profile."));
  }
  if (!text(measurement.promiseArtifactId) || !Number.isInteger(measurement.promiseRevision) || measurement.promiseRevision < 1) {
    issues.push(issue("missing_delivery_promise", "Delivery review must bind the approved promise artifact revision."));
  }
  const required = ["technical", "visual", "audio", "promisePreservation"];
  if (!measurement.checks || required.some((key) => measurement.checks[key] !== "passed")) {
    issues.push(issue("incomplete_delivery_review", "Technical, visual, audio, and promise-preservation checks must all pass."));
  }
  return issues;
}

function documentIssues(evidence) {
  const issues = [];
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    return [issue("invalid_evidence_document", "Evidence document must be an object.")];
  }
  if (evidence.version !== "1.0") issues.push(issue("unsupported_evidence_version", "Evidence version must be 1.0."));
  if (!["release_candidate", "test_fixture"].includes(evidence.scope)) {
    issues.push(issue("invalid_evidence_scope", "scope must be release_candidate or test_fixture."));
  }
  if (!Array.isArray(evidence.corpora)) issues.push(issue("invalid_corpora", "corpora must be an array."));
  if (!Array.isArray(evidence.measurements)) issues.push(issue("invalid_measurements", "measurements must be an array."));
  if (Array.isArray(evidence.corpora)) {
    const ids = evidence.corpora.map((entry) => entry?.id);
    if (ids.some((id) => !text(id))) {
      issues.push(issue("invalid_corpus_id", "Every corpus must have a non-empty id."));
    }
    if (new Set(ids).size !== ids.length) {
      issues.push(issue("duplicate_corpus_id", "Corpus ids must be unique; duplicate declarations are ambiguous."));
    }
  }
  return issues;
}

export function evaluateReleaseGates(manifest, evidence = null) {
  if (!manifest || manifest.version !== "1.0" || !Array.isArray(manifest.gates)) {
    throw new Error("Release gate manifest is invalid or unsupported.");
  }
  const validationIssues = evidence ? documentIssues(evidence) : [];
  const corpora = new Map((Array.isArray(evidence?.corpora) ? evidence.corpora : []).map((entry) => [entry?.id, entry]));
  const knownIds = new Set((manifest.knownCorpora ?? []).map((entry) => entry.id));
  const grouped = new Map();
  for (const measurement of Array.isArray(evidence?.measurements) ? evidence.measurements : []) {
    const list = grouped.get(measurement?.gateId) ?? [];
    list.push(measurement);
    grouped.set(measurement?.gateId, list);
  }
  const knownGateIds = new Set(manifest.gates.map((gate) => gate.id));
  for (const gateId of grouped.keys()) {
    if (!knownGateIds.has(gateId)) validationIssues.push(issue("unknown_gate", `Evidence references unknown gate ${gateId}.`));
  }

  const gates = manifest.gates.map((gate) => {
    const entries = grouped.get(gate.id) ?? [];
    if (!entries.length) return { ...gate, status: "not_measured", blocking: true, issues: [] };
    if (entries.length > 1) return { ...gate, status: "invalid", blocking: true,
      issues: [issue("duplicate_gate_evidence", "Exactly one evidence entry is allowed per gate.")] };
    const measurement = entries[0];
    const issues = baseIssues(measurement);
    if (gate.evidenceType === "corpus_measurement") issues.push(...corpusIssues(measurement, corpora), ...corpusSlotIssues(gate, measurement));
    if (gate.evidenceType === "independent_holdout") issues.push(...holdoutIssues(measurement, corpora, knownIds));
    if (gate.evidenceType === "quality_measurement") issues.push(...qualityIssues(gate, measurement));
    if (gate.evidenceType === "human_attestation") issues.push(...humanIssues(gate, measurement));
    if (gate.evidenceType === "delivery_review") issues.push(...deliveryIssues(measurement));
    const status = issues.length ? "invalid" : measurement.outcome === "passed" ? "measured_passed" : "measured_failed";
    return { ...gate, status, blocking: status !== "measured_passed", issues,
      evidence: { measuredAt: measurement.measuredAt ?? null, method: measurement.method ?? null,
        evidenceRefs: measurement.evidenceRefs ?? [], corpusId: measurement.corpusId ?? null } };
  });
  const summary = {
    total: gates.length,
    measuredPassed: gates.filter((gate) => gate.status === "measured_passed").length,
    measuredFailed: gates.filter((gate) => gate.status === "measured_failed").length,
    notMeasured: gates.filter((gate) => gate.status === "not_measured").length,
    invalid: gates.filter((gate) => gate.status === "invalid").length
  };
  const evidenceComplete = validationIssues.length === 0 && gates.every((gate) => gate.status === "measured_passed");
  const fixture = evidence?.scope === "test_fixture";
  return {
    version: "1.0", scope: manifest.scope,
    status: evidenceComplete ? (fixture ? "fixture_passed" : "evidence_complete") : "blocked",
    releaseDefault: null, releaseReady: false,
    ownerDecisionRequired: evidenceComplete && !fixture,
    fixture, summary, documentIssues: validationIssues, gates,
    note: fixture
      ? "Fixture evidence only verifies gate mechanics and cannot certify a release."
      : evidenceComplete
        ? "Evidence is complete; an explicit owner decision is still required before any release default can change."
        : "Broad release remains blocked by missing, failed, or invalid evidence."
  };
}
