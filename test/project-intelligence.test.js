import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProjectStore } from "../src/project/project-store.js";
import { IntelligenceValidationError } from "../src/intelligence/contracts.js";
import { createDefaultSkillCatalog } from "../src/intelligence/skill-catalog.js";
import { WorkflowTemplateCatalog } from "../src/intelligence/workflow-template-catalog.js";
import { ProjectContextAssembler } from "../src/intelligence/project-context-assembler.js";

async function fixture(t) {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-intelligence-test-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  const store = new ProjectStore(rootDir);
  await store.createProject({ projectId: "demo", title: "Intelligence demo" });
  return { workspace, rootDir, store };
}

function workItem(overrides = {}) {
  return {
    id: "direction",
    title: "Choose direction",
    purpose: "Commit to an evidence-backed creative direction.",
    status: "ready",
    dependsOn: [],
    skillIds: ["creative-direction"],
    inputReferences: [],
    expectedOutputs: [
      { kind: "artifact", type: "creative.direction", description: "Chosen direction." }
    ],
    outputReferences: [],
    review: {
      required: true,
      perspective: "creative",
      criteria: ["serves the brief"]
    },
    approval: "required",
    ...overrides
  };
}

function briefData(purpose = "Make a short, useful video.") {
  return {
    version: "1.0",
    purpose,
    audience: "People who need a clear introduction.",
    desiredOutcome: "The viewer understands the main idea and can decide what to do next.",
    constraints: [],
    knownFacts: [],
    assumptions: [],
    openQuestions: [],
  };
}

function directionData(briefArtifactId, principle = "Keep the explanation clear and grounded.") {
  return {
    version: "1.0",
    basis: { kind: "direct", briefArtifactId },
    selectionReason: "The user chose this direction directly from the brief.",
    principles: [principle],
    avoidances: ["Do not add decoration that competes with the explanation."],
    reviewCriteria: ["The result serves the brief."],
    sample: null,
  };
}

async function supportingBrief(store, key = "supporting-brief") {
  return store.recordArtifact("demo", {
    key,
    type: "project.brief",
    name: "Supporting brief",
    summary: "Grounds the creative direction used by this test.",
    data: briefData(),
    references: [],
  });
}

test("artifacts are immutable revisions with traceable active state", async (t) => {
  const { rootDir, store } = await fixture(t);
  const brief = await store.recordArtifact("demo", {
    key: "project-brief",
    type: "project.brief",
    name: "Project brief",
    summary: "A concise first brief.",
    data: briefData("Make a short launch film."),
    references: [],
    status: "active",
    createdBy: "agent"
  });
  const draft = await store.recordArtifact("demo", {
    key: "project-brief",
    type: "project.brief",
    name: "Project brief",
    summary: "A proposed revision.",
    data: briefData("Make a warmer launch film."),
    references: [{ kind: "artifact", id: brief.id }],
    status: "draft",
    createdBy: "agent",
    expectedRevision: brief.revision,
  });

  assert.equal(draft.revision, 2);
  assert.equal(draft.supersedes, brief.id);
  assert.deepEqual((await store.intelligence.readActiveArtifacts("demo")).map((item) => item.id), [brief.id]);
  assert.deepEqual(JSON.parse(await readFile(join(rootDir, "demo", "artifacts", brief.id + ".json"), "utf8")), brief);

  await assert.rejects(
    store.recordArtifact("demo", {
      key: "bad",
      type: "project.brief",
      name: "Bad",
      summary: "Broken provenance.",
      data: briefData(),
      references: [{ kind: "result", id: "missing-result" }]
    }),
    IntelligenceValidationError
  );
});

test("video sequences have one current revision while draft alternatives are explicit candidates", async (t) => {
  const { store } = await fixture(t);
  const data = (changeReason) => ({
    version: "1.0", changeReason, format: { width: 320, height: 180, fps: 25 },
    segments: [{ id: "opening", title: "Opening", intent: "Test state", durationSeconds: 1, visual: null }],
  });
  const current = await store.recordArtifact("demo", {
    key: "film", type: "video.sequence", name: "Film", summary: "Current cut", status: "active", data: data("Initial cut"),
  });
  const candidate = await store.recordArtifact("demo", {
    key: "alternative", type: "video.sequence", name: "Alternative", summary: "Candidate cut", status: "draft", data: data("Candidate cut"),
  });
  await assert.rejects(store.recordArtifact("demo", {
    key: "alternative", type: "video.sequence", name: "Alternative", summary: "Invalid second current", status: "active",
    expectedRevision: candidate.revision, data: data("Try to activate a second current cut"),
  }), /already current/);
  let context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(context.production.sequences.find((sequence) => sequence.artifactId === current.id).role, "current");
  assert.equal(context.production.sequences.find((sequence) => sequence.artifactId === candidate.id).role, "candidate");

  await store.recordArtifact("demo", {
    key: "film", type: "video.sequence", name: "Film", summary: "Retired cut", status: "retired",
    expectedRevision: current.revision, data: data("Replaced by the selected alternative"),
  });
  const selected = await store.recordArtifact("demo", {
    key: "alternative", type: "video.sequence", name: "Alternative", summary: "Selected cut", status: "active",
    expectedRevision: candidate.revision, data: data("Selected as current"),
  });
  context = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.deepEqual(context.production.sequences.filter((sequence) => sequence.role === "current").map((sequence) => sequence.artifactId), [selected.id]);
  assert.equal(context.production.sequences.find((sequence) => sequence.artifactId === current.id).role, "history");
});

test("adaptive workflow preserves revisions and rejects cycles or premature progress", async (t) => {
  const { store } = await fixture(t);
  const brief = await supportingBrief(store);
  const workflow = await store.writeWorkflow("demo", {
    name: "Creative choice",
    purpose: "Choose a direction before production.",
    status: "active",
    items: [workItem()]
  });
  const direction = await store.recordArtifact("demo", {
    key: "direction-for-review",
    type: "creative.direction",
    name: "Direction",
    summary: "Direction output ready for review.",
    data: directionData(brief.id),
    references: [{ kind: "artifact", id: brief.id }],
    status: "active",
    createdBy: "agent"
  });

  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
      expectedRevision: workflow.revision,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: "Invalid completion.",
      items: [workItem({ status: "completed", outputReferences: [{ kind: "artifact", id: direction.id }] })]
    }),
    /passing review/
  );

  const awaiting = await store.writeWorkflow("demo", {
    id: workflow.id,
    expectedRevision: workflow.revision,
    name: workflow.name,
    purpose: workflow.purpose,
    status: "active",
    changeReason: "Direction is ready for review.",
    items: [workItem({
      status: "awaiting_review",
      outputReferences: [{ kind: "artifact", id: direction.id }]
    })]
  });
  const beforeApproval = await store.readContext("demo");
  assert.equal(beforeApproval.intelligence.currentWorkItems[0].status, "awaiting_review");

  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
      expectedRevision: awaiting.revision,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: "Cycle test.",
      items: [
        workItem({ id: "a", dependsOn: ["b"], review: { required: false, criteria: [] }, approval: "auto", status: "planned" }),
        workItem({ id: "b", dependsOn: ["a"], review: { required: false, criteria: [] }, approval: "auto", status: "planned" })
      ]
    }),
    /cycle/
  );
  await assert.rejects(
    store.writeWorkflow("demo", {
      name: "Unknown skill",
      purpose: "Reject plans that cannot resolve their working method.",
      items: [workItem({
        skillIds: ["missing-skill"],
        review: { required: false, perspective: "combined", criteria: [] },
        approval: "auto"
      })]
    }),
    /Unknown workflow skills/
  );
  await assert.rejects(
    store.writeWorkflow("demo", {
      name: "Premature child",
      purpose: "Reject work that jumps its dependency.",
      items: [
        workItem({
          id: "parent",
          status: "planned",
          review: { required: false, perspective: "combined", criteria: [] },
          approval: "auto"
        }),
        workItem({
          id: "child",
          status: "ready",
          dependsOn: ["parent"],
          review: { required: false, perspective: "combined", criteria: [] },
          approval: "auto"
        })
      ]
    }),
    /incomplete dependencies/
  );
  assert.equal((await store.readWorkflows("demo")).length, 2);
  assert.equal(awaiting.revision, 2);
});

test("review and user approval are hard gates while decisions retain rationale", async (t) => {
  const { rootDir, store } = await fixture(t);
  const brief = await supportingBrief(store);
  const direction = await store.recordArtifact("demo", {
    key: "selected-direction",
    type: "creative.direction",
    name: "Selected direction",
    summary: "The direction that is ready for review.",
    data: directionData(brief.id),
    references: [{ kind: "artifact", id: brief.id }],
    status: "active",
    createdBy: "agent"
  });
  const directionOutput = [{ kind: "artifact", id: direction.id }];
  const workflow = await store.writeWorkflow("demo", {
    name: "Creative choice",
    purpose: "Choose a direction before production.",
    status: "active",
    items: [workItem({ status: "awaiting_review", outputReferences: directionOutput })]
  });
  await assert.rejects(
    store.recordReview("demo", {
      target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction", typo: true },
      perspective: "creative",
      verdict: "passed",
      summary: "Strict target shape.",
      criteria: [{ id: "strict", criterion: "Strict", status: "passed", evidence: "Valid." }]
    }),
    /unsupported fields/
  );
  await assert.rejects(
    store.recordReview("demo", {
      target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
      perspective: "creative",
      verdict: "passed_with_notes",
      summary: "An invalid mixed verdict.",
      criteria: [
        {
          id: "failed-check",
          criterion: "Must pass",
          status: "failed",
          evidence: "It did not pass.",
          proposedAction: "Revise it."
        }
      ]
    }),
    /cannot contain failures/
  );
  const review = await store.recordReview("demo", {
    target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
    perspective: "creative",
    verdict: "passed_with_notes",
    summary: "The direction serves the brief; tighten the final beat.",
    criteria: [
      {
        id: "serves-brief",
        criterion: "Serves the brief",
        status: "warning",
        evidence: "Tone and audience align; final beat is less distinctive.",
        proposedAction: "Sharpen the final beat during production."
      }
    ],
    reviewer: "agent"
  });
  const awaitingApproval = await store.writeWorkflow("demo", {
    id: workflow.id,
    expectedRevision: workflow.revision,
    name: workflow.name,
    purpose: workflow.purpose,
    status: "active",
    changeReason: "Review passed; the direction is ready for user approval.",
    items: [workItem({
      status: "awaiting_approval",
      outputReferences: directionOutput
    })]
  });
  assert.equal(awaitingApproval.revision, 2);
  const beforeApproval = await store.readContext("demo");
  assert.equal(beforeApproval.intelligence.pendingApprovals[0].id, "direction");
  const decision = await store.recordDecision("demo", {
    target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
    category: "creative_direction_approval",
    subject: "Approve the selected direction",
    outcome: "approved",
    options: [
      { id: "warm", label: "Warm documentary", description: "Human and grounded." },
      { id: "graphic", label: "Graphic energy", description: "Fast and abstract." }
    ],
    selected: "warm",
    reason: "The warm direction better serves the audience.",
    decidedBy: "user",
    userVisible: true,
    confidence: "high"
  });
  const revoked = await store.recordDecision("demo", {
    target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
    category: "creative_direction_approval",
    subject: "Withdraw direction approval",
    outcome: "rejected",
    options: [],
    selected: null,
    reason: "New information requires another check.",
    decidedBy: "user",
    userVisible: true,
    confidence: "high"
  });
  const completedRequest = {
    id: workflow.id,
    expectedRevision: awaitingApproval.revision,
    name: workflow.name,
    purpose: workflow.purpose,
    status: "completed",
    changeReason: "Review passed and the user approved the direction.",
    items: [workItem({
      status: "completed",
      outputReferences: directionOutput
    })]
  };
  await assert.rejects(store.writeWorkflow("demo", completedRequest), /user approval/);
  const finalApproval = await store.recordDecision("demo", {
    target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
    category: "creative_direction_approval",
    subject: "Approve after recheck",
    outcome: "approved",
    options: [],
    selected: null,
    reason: "The recheck resolved the concern.",
    decidedBy: "user",
    userVisible: true,
    confidence: "high"
  });
  assert.deepEqual(finalApproval.binding.outputReferences, directionOutput);
  assert.equal(finalApproval.binding.reviewId, review.id);
  const completed = await store.writeWorkflow("demo", completedRequest);

  assert.equal(completed.revision, 3);
  assert.equal(decision.kind, "project_decision");
  assert.equal(decision.selected, "warm");
  assert.ok(decision.createdAt < revoked.createdAt);
  assert.ok(revoked.createdAt < finalApproval.createdAt);
  const reopened = await new ProjectStore(rootDir).readContext("demo");
  assert.equal(reopened.intelligence.activeWorkflow, null);
  assert.equal(reopened.projectDecisions[0].reason, decision.reason);
  assert.equal(reopened.reviews[0].round, 1);
});

test("review and approval are bound to the current work item outputs", async (t) => {
  const { store } = await fixture(t);
  const brief = await supportingBrief(store);
  const workflow = await store.writeWorkflow("demo", {
    name: "Bound gate",
    purpose: "Prevent stale review and approval reuse.",
    status: "active",
    items: [workItem({ status: "planned" })]
  });
  const reviewValue = {
    target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
    perspective: "creative",
    verdict: "passed",
    summary: "The current direction passes.",
    criteria: [{
      id: "serves-brief",
      criterion: "Serves the brief",
      status: "passed",
      evidence: "The evidence matches the current output."
    }],
    reviewer: "agent"
  };
  await assert.rejects(store.recordReview("demo", reviewValue), /awaiting_review/);
  await assert.rejects(
    store.recordDecision("demo", {
      target: { kind: "work_item", workflowId: workflow.id, workItemId: "direction" },
      category: "approval",
      subject: "Premature approval",
      outcome: "approved",
      options: [],
      selected: null,
      reason: "There is no output yet.",
      decidedBy: "user",
      userVisible: true,
      confidence: "high"
    }),
    /awaiting_approval/
  );

  const firstOutput = await store.recordArtifact("demo", {
    key: "first-direction",
    type: "creative.direction",
    name: "First direction",
    summary: "First reviewable output.",
    data: directionData(brief.id, "Make the first direction specific."),
    references: [{ kind: "artifact", id: brief.id }], status: "active", createdBy: "agent"
  });
  const secondOutput = await store.recordArtifact("demo", {
    key: "second-direction",
    type: "creative.direction",
    name: "Second direction",
    summary: "A different, unreviewed output.",
    data: directionData(brief.id, "Make the second direction meaningfully different."),
    references: [{ kind: "artifact", id: brief.id }], status: "active", createdBy: "agent"
  });
  const awaitingReview = await store.writeWorkflow("demo", {
    id: workflow.id,
    expectedRevision: workflow.revision,
    name: workflow.name,
    purpose: workflow.purpose,
    status: "active",
    changeReason: "The first output is ready for review.",
    items: [workItem({
      status: "awaiting_review",
      outputReferences: [{ kind: "artifact", id: firstOutput.id }]
    })]
  });
  await assert.rejects(
    store.recordReview("demo", { ...reviewValue, perspective: "technical" }),
    /perspective/
  );
  await assert.rejects(
    store.recordReview("demo", {
      ...reviewValue,
      criteria: [{
        id: "unrelated",
        criterion: "Unrelated criterion",
        status: "passed",
        evidence: "This does not cover the required criterion."
      }]
    }),
    /does not cover required criteria/
  );
  const review = await store.recordReview("demo", reviewValue);
  assert.equal(review.binding.workflowRevision, awaitingReview.revision);
  assert.deepEqual(review.binding.outputReferences, awaitingReview.items[0].outputReferences);

  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
      expectedRevision: awaitingReview.revision,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: "Attempt to add an unreviewed output.",
      items: [workItem({
        status: "awaiting_approval",
        outputReferences: [
          { kind: "artifact", id: firstOutput.id },
          { kind: "artifact", id: secondOutput.id }
        ]
      })]
    }),
    /passing review/
  );
  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
      expectedRevision: awaitingReview.revision,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: "Attempt to rewrite reviewed work.",
      items: [workItem({
        title: "A different task",
        status: "awaiting_approval",
        outputReferences: [{ kind: "artifact", id: firstOutput.id }]
      })]
    }),
    /change its identity/
  );
});

test("skill and workflow template catalogs expose method, standards, and optional starting points", async () => {
  const skills = await createDefaultSkillCatalog().listPublic();
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ["adaptive-planning", "asset-preparation", "creative-direction", "project-intake", "result-review", "source-understanding", "video-editing-craft", "video-sequence-planning"]
  );
  const reviewSkill = await createDefaultSkillCatalog().read("result-review");
  assert.match(reviewSkill.instructionsText, /technical integrity and creative effectiveness separately/i);

  const templates = await new WorkflowTemplateCatalog().list();
  assert.deepEqual(templates.map((template) => template.id), ["creative-production", "quick-media-task"]);
  const instance = await new WorkflowTemplateCatalog().instantiate("quick-media-task", {
    name: "Custom start",
    purpose: "Start from a template, then adapt."
  });
  assert.equal(instance.name, "Custom start");
  assert.equal(instance.metadata.templateId, "quick-media-task");
  assert.ok(instance.items.every((item) => typeof item.purpose === "string"));
  assert.equal(instance.items.find((item) => item.id === "review-result").review.required, false);
  await assert.rejects(
    new WorkflowTemplateCatalog().instantiate("quick-media-task", { unknown: true }),
    /unsupported fields/
  );
});

test("workflow lifecycle stays singular, terminal, and safe to resume", async (t) => {
  const { store } = await fixture(t);
  const first = await store.writeWorkflow("demo", {
    name: "First workflow",
    purpose: "Exercise workflow lifecycle invariants.",
    status: "active",
    items: [workItem({
      review: { required: false, perspective: "combined", criteria: [] },
      approval: "auto"
    })]
  });
  await store.writeCheckpoint("demo", {
    goal: "Continue the first workflow.",
    selectedResources: [],
    next: "Continue.",
    activeWorkflowId: first.id,
    activeWorkItemId: "direction"
  });
  await assert.rejects(
    store.writeWorkflow("demo", {
      name: "Conflicting workflow",
      purpose: "Must not become a second active workflow.",
      status: "active",
      items: [workItem({
        review: { required: false, perspective: "combined", criteria: [] },
        approval: "auto"
      })]
    }),
    /already active/
  );
  const completed = await store.writeWorkflow("demo", {
    id: first.id,
    expectedRevision: first.revision,
    name: first.name,
    purpose: first.purpose,
    status: "completed",
    changeReason: "The only work item is complete.",
    items: [workItem({
      status: "completed",
      review: { required: false, perspective: "combined", criteria: [] },
      approval: "auto",
      expectedOutputs: [{ kind: "workflow", description: "Recorded workflow." }],
      outputReferences: [{ kind: "workflow", id: first.id }]
    })]
  });
  assert.equal(completed.revision, 2);
  const afterCompletion = await new ProjectContextAssembler({ projectStore: store }).build("demo");
  assert.equal(afterCompletion.resumeView.activeWorkflowId, null);
  assert.equal(afterCompletion.resumeView.activeWorkItemId, null);
  await assert.rejects(
    store.writeWorkflow("demo", {
      id: first.id,
      expectedRevision: completed.revision,
      name: first.name,
      purpose: first.purpose,
      status: "active",
      changeReason: "Invalid terminal regression.",
      items: [workItem({
        status: "ready",
        review: { required: false, perspective: "combined", criteria: [] },
        approval: "auto"
      })]
    }),
    /terminal/
  );
});

test("context assembler joins durable intelligence, resume state, and real capabilities", async (t) => {
  const { store } = await fixture(t);
  const workflow = await store.writeWorkflow("demo", {
    name: "Resume demo",
    purpose: "Expose the current work without selecting creative work for the Agent.",
    status: "active",
    items: [workItem({ review: { required: false, perspective: "combined", criteria: [] }, approval: "auto" })]
  });
  await store.writeCheckpoint("demo", {
    goal: "Continue the creative direction.",
    selectedResources: [],
    next: "Work from the active graph.",
    activeWorkflowId: workflow.id,
    activeWorkItemId: "direction",
    activeArtifacts: [],
    pendingDecisions: [],
    resume: {
      summary: "Brief is ready; direction is next.",
      risks: ["No source media yet."],
      blockedBy: []
    }
  });
  const registry = {
    async describeCapabilities() {
      return {
        capabilities: [{ id: "media.inspect", tools: [{ name: "probe", available: true }] }]
      };
    }
  };
  const assembler = new ProjectContextAssembler({ projectStore: store, toolRegistry: registry });
  const context = await assembler.build("demo");

  assert.equal(context.resumeView.activeWorkflowId, workflow.id);
  assert.equal(context.resumeView.activeWorkItemId, "direction");
  assert.equal(context.resumeView.attention[0].purpose, workItem().purpose);
  assert.equal(context.capabilities.capabilities[0].id, "media.inspect");
  assert.equal(context.intelligence.relevantSkills[0].id, "creative-direction");
  assert.equal(context.checkpointFreshness.status, "current");
  const summary = await assembler.buildSummary("demo");
  assert.equal(summary.resumeView.activeWorkflowId, workflow.id);
  assert.equal(summary.resumeView.activeWorkItemId, "direction");
  assert.equal(summary.checkpointFreshness.status, "current");
  assert.deepEqual(summary.production.affectedWorkItems, []);
});

test("context reports stale checkpoints and refreshes capability availability after its TTL", async (t) => {
  const { store } = await fixture(t);
  await store.writeCheckpoint("demo", {
    goal: "Keep the resume point current.",
    selectedResources: [],
    next: "Continue."
  });
  await store.recordArtifact("demo", {
    key: "new-understanding",
    type: "project.brief",
    name: "New understanding",
    summary: "This was recorded after the checkpoint.",
    data: briefData(), references: [], status: "active", createdBy: "agent"
  });

  let clock = 0;
  let checks = 0;
  const registry = {
    async describeCapabilities() {
      checks += 1;
      return { capabilities: [{ id: "dynamic", check: checks }] };
    }
  };
  const assembler = new ProjectContextAssembler({
    projectStore: store,
    toolRegistry: registry,
    capabilityCacheTtlMs: 100,
    now: () => clock
  });
  const first = await assembler.build("demo");
  assert.equal(first.checkpointFreshness.status, "stale");
  assert.deepEqual(first.checkpointFreshness.newerActivityKinds, ["artifact"]);
  assert.equal(first.capabilities.capabilities[0].check, 1);
  const summary = await assembler.buildSummary("demo");
  assert.equal(summary.checkpointFreshness.status, "stale");
  assert.deepEqual(summary.resumeView.checkpointFreshness, summary.checkpointFreshness);

  clock = 50;
  const cached = await assembler.build("demo");
  assert.equal(cached.capabilities.capabilities[0].check, 1);
  clock = 100;
  const refreshed = await assembler.build("demo");
  assert.equal(refreshed.capabilities.capabilities[0].check, 2);
});

test("legacy projects without intelligence directories still reopen", async (t) => {
  const { rootDir, store } = await fixture(t);
  await Promise.all(
    ["artifacts", "workflows", "reviews", "skills"].map((name) =>
      rm(join(rootDir, "demo", name), { recursive: true, force: true })
    )
  );
  const reopened = await new ProjectStore(rootDir).readContext("demo");
  assert.deepEqual(reopened.artifacts, []);
  assert.deepEqual(reopened.workflows, []);
  assert.deepEqual(reopened.reviews, []);
  assert.equal(reopened.intelligence.activeWorkflow, null);
});
