import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { normalizeCreativeArtifactData } from "../src/intelligence/creative-artifacts.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-creative-artifacts-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Creative artifact test" });
  return { rootDir, store };
}

function briefData(purpose = "Turn one lesson into a concise vertical micro-lesson.") {
  return {
    version: "1.0",
    purpose,
    audience: "Beginning competitive-programming students watching on a phone.",
    desiredOutcome: "The viewer can explain brute force and recognize when it is useful.",
    constraints: ["Use only registered source media", "Target a 30-60 second sample"],
    knownFacts: ["The source is a portrait lesson with existing narration"],
    assumptions: ["The original voice should be retained for the first sample"],
    openQuestions: ["Which hook best fits the intended publishing channel?"],
  };
}

function option(id, name, hook) {
  return {
    id,
    name,
    premise: `${name} explains brute force through one concrete mental model.`,
    hook,
    narrativeApproach: "Hook, example, concise definition, and practical takeaway.",
    audienceExperience: "Fast to enter, easy to follow, and grounded in the source lesson.",
    visualPrinciples: ["Keep important text inside the portrait safe area"],
    audioPrinciples: ["Preserve the intelligibility of the source voice"],
    advantages: ["Can be sampled entirely from existing media"],
    tradeoffs: ["The short duration omits secondary examples"],
    risks: ["A fast cut may remove context needed by beginners"],
    sample: {
      purpose: "Test whether the hook and explanation work together.",
      durationSeconds: 45,
      successCriteria: ["A viewer understands the analogy without prior context"],
    },
  };
}

function proposalData() {
  return {
    version: "1.0",
    comparisonCriteria: ["Clarity for beginners", "Strength of hook", "Feasibility with current media"],
    options: [
      option("keys-first", "Keys first", "How many keys would you try before changing strategy?"),
      option("definition-first", "Definition first", "Brute force is not always a bad idea."),
    ],
    recommendedOptionId: "keys-first",
    recommendationReason: "The concrete key analogy creates a faster entry for beginners.",
  };
}

function directionData(proposalArtifactId, optionId = "keys-first") {
  return {
    version: "1.0",
    basis: { kind: "proposal", proposalArtifactId, optionId },
    selectionReason: "The user chose the clearest source-backed hook.",
    principles: ["Lead with the analogy before naming the concept", "Keep every cut useful to comprehension"],
    avoidances: ["Do not imply brute force is always inefficient"],
    reviewCriteria: ["The hook is understandable without prior context", "Claims remain faithful to the source"],
    sample: {
      purpose: "Validate the selected hook and teaching rhythm before expanding production.",
      durationSeconds: 45,
      successCriteria: ["The sample states one accurate takeaway", "The source voice remains clear"],
    },
  };
}

test("creative artifact contracts reject ambiguous or incomplete content", () => {
  assert.throws(
    () => normalizeCreativeArtifactData("project.brief", { purpose: "Missing version" }),
    /version must be 1.0/,
  );
  assert.throws(
    () => normalizeCreativeArtifactData("creative.proposal", {
      ...proposalData(),
      options: [option("only", "Only option", "One option cannot be compared.")],
    }),
    /between 2 and 5 options/,
  );
  assert.throws(
    () => normalizeCreativeArtifactData("creative.proposal", {
      ...proposalData(),
      recommendedOptionId: "missing",
    }),
    /must identify an option/,
  );
  assert.throws(
    () => normalizeCreativeArtifactData("creative.direction", {
      ...directionData("artifact-proposal"),
      reviewCriteria: [],
    }),
    /reviewCriteria must not be empty/,
  );
  assert.throws(
    () => normalizeCreativeArtifactData("creative.direction", {
      ...directionData("artifact-proposal"),
      sample: { purpose: "Too long", durationSeconds: 601, successCriteria: ["Review it"] },
    }),
    /between 1 and 600/,
  );
  assert.throws(
    () => normalizeCreativeArtifactData("creative.direction", {
      ...directionData("artifact proposal with spaces"),
    }),
    /proposalArtifactId has an invalid identifier format/,
  );
});

test("brief, proposal and chosen direction keep exact provenance and revisions", async (t) => {
  const { store } = await fixture(t);
  const brief = await store.recordArtifact("demo", {
    key: "brief",
    type: "project.brief",
    name: "Pilot brief",
    summary: "Create a source-led vertical micro-lesson.",
    data: briefData(),
    references: [],
  });
  const proposal = await store.recordArtifact("demo", {
    key: "proposal",
    type: "creative.proposal",
    name: "Pilot directions",
    summary: "Two meaningfully different hooks for the same lesson.",
    data: proposalData(),
    references: [{ kind: "artifact", id: brief.id }],
  });
  const direction = await store.recordArtifact("demo", {
    key: "direction",
    type: "creative.direction",
    name: "Selected direction",
    summary: "Lead with the key analogy.",
    data: directionData(proposal.id),
    references: [{ kind: "artifact", id: proposal.id }],
  });

  assert.equal(proposal.data.options.length, 2);
  assert.equal(direction.data.basis.optionId, proposal.data.recommendedOptionId);
  assert.deepEqual(direction.references, [{ kind: "artifact", id: proposal.id }]);
  await assert.rejects(
    store.recordArtifact("demo", {
      key: "direction", type: "creative.direction", name: "Stale revision",
      summary: "Must reread first.", data: directionData(proposal.id),
      references: [{ kind: "artifact", id: proposal.id }],
    }),
    /revision conflict/,
  );
  const revised = await store.recordArtifact("demo", {
    key: "direction", type: "creative.direction", name: "Selected direction",
    summary: "Clarify the practical takeaway.",
    data: { ...directionData(proposal.id), selectionReason: "The user retained the hook and requested a clearer ending." },
    references: [{ kind: "artifact", id: proposal.id }],
    expectedRevision: direction.revision,
  });
  assert.equal(revised.revision, 2);
  assert.equal(revised.supersedes, direction.id);
});

test("creative provenance rejects missing, mismatched, or unknown basis", async (t) => {
  const { store } = await fixture(t);
  const brief = await store.recordArtifact("demo", {
    key: "brief", type: "project.brief", name: "Pilot brief",
    summary: "A complete brief.", data: briefData(), references: [],
  });
  await assert.rejects(
    store.recordArtifact("demo", {
      key: "orphan-proposal", type: "creative.proposal", name: "Orphan proposal",
      summary: "Has no brief provenance.", data: proposalData(), references: [],
    }),
    /must reference a project\.brief artifact/,
  );
  const proposal = await store.recordArtifact("demo", {
    key: "proposal", type: "creative.proposal", name: "Pilot directions",
    summary: "Two directions.", data: proposalData(),
    references: [{ kind: "artifact", id: brief.id }],
  });
  await assert.rejects(
    store.recordArtifact("demo", {
      key: "missing-basis", type: "creative.direction", name: "Missing basis",
      summary: "Does not reference its proposal.", data: directionData(proposal.id),
      references: [{ kind: "artifact", id: brief.id }],
    }),
    /must reference the artifact declared by data\.basis/,
  );
  await assert.rejects(
    store.recordArtifact("demo", {
      key: "unknown-option", type: "creative.direction", name: "Unknown option",
      summary: "Selects an option that was never proposed.", data: directionData(proposal.id, "missing"),
      references: [{ kind: "artifact", id: proposal.id }],
    }),
    /basis\.optionId must identify an option in the proposal/,
  );
});

test("legacy creative artifacts remain readable and can be retired", async (t) => {
  const { rootDir, store } = await fixture(t);
  const legacy = {
    version: "1.0",
    id: "artifact-legacy",
    projectId: "demo",
    key: "legacy-direction",
    revision: 1,
    supersedes: null,
    type: "creative.direction",
    name: "Legacy direction",
    summary: "Created before the strict creative contract.",
    status: "active",
    data: { mood: "calm" },
    references: [],
    createdBy: "agent",
    createdAt: "2026-09-10T00:00:00.000Z",
  };
  await writeFile(
    join(rootDir, "demo", "artifacts", "artifact-legacy.json"),
    `${JSON.stringify(legacy, null, 2)}\n`,
    "utf8",
  );

  const artifacts = await store.intelligence.readArtifacts("demo");
  assert.equal(artifacts[0].data.mood, "calm");
  const retired = await store.recordArtifact("demo", {
    key: legacy.key,
    type: legacy.type,
    name: legacy.name,
    summary: "Retire the legacy record without rewriting history.",
    status: "retired",
    data: legacy.data,
    references: [],
    expectedRevision: 1,
  });
  assert.equal(retired.revision, 2);
  assert.equal(retired.status, "retired");
  assert.deepEqual(await store.intelligence.readActiveArtifacts("demo"), []);
});
