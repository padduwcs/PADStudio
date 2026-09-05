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

test("artifacts are immutable revisions with traceable active state", async (t) => {
  const { rootDir, store } = await fixture(t);
  const brief = await store.recordArtifact("demo", {
    key: "project-brief",
    type: "project.brief",
    name: "Project brief",
    summary: "A concise first brief.",
    data: { purpose: "Make a short launch film." },
    references: [],
    status: "active",
    createdBy: "agent"
  });
  const draft = await store.recordArtifact("demo", {
    key: "project-brief",
    type: "project.brief",
    name: "Project brief",
    summary: "A proposed revision.",
    data: { purpose: "Make a warmer launch film." },
    references: [{ kind: "artifact", id: brief.id }],
    status: "draft",
    createdBy: "agent"
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
      data: {},
      references: [{ kind: "result", id: "missing-result" }]
    }),
    IntelligenceValidationError
  );
});

test("adaptive workflow preserves revisions and rejects cycles or premature progress", async (t) => {
  const { store } = await fixture(t);
  const workflow = await store.writeWorkflow("demo", {
    name: "Creative choice",
    purpose: "Choose a direction before production.",
    status: "active",
    items: [workItem()]
  });

  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
      name: workflow.name,
      purpose: workflow.purpose,
      status: "active",
      changeReason: "Invalid completion.",
      items: [workItem({ status: "completed" })]
    }),
    /passing review/
  );

  const awaiting = await store.writeWorkflow("demo", {
    id: workflow.id,
    name: workflow.name,
    purpose: workflow.purpose,
    status: "active",
    changeReason: "Direction is ready for review.",
    items: [workItem({ status: "awaiting_review" })]
  });
  const beforeApproval = await store.readContext("demo");
  assert.equal(beforeApproval.intelligence.currentWorkItems[0].status, "awaiting_review");

  await assert.rejects(
    store.writeWorkflow("demo", {
      id: workflow.id,
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
  const workflow = await store.writeWorkflow("demo", {
    name: "Creative choice",
    purpose: "Choose a direction before production.",
    status: "active",
    items: [workItem({ status: "awaiting_review" })]
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
    name: workflow.name,
    purpose: workflow.purpose,
    status: "active",
    changeReason: "Review passed; the direction is ready for user approval.",
    items: [workItem({
      status: "awaiting_approval",
      outputReferences: [{ kind: "review", id: review.id }]
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
    name: workflow.name,
    purpose: workflow.purpose,
    status: "completed",
    changeReason: "Review passed and the user approved the direction.",
    items: [workItem({
      status: "completed",
      outputReferences: [{ kind: "review", id: review.id }]
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

test("skill and workflow template catalogs expose method, standards, and optional starting points", async () => {
  const skills = await createDefaultSkillCatalog().listPublic();
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ["adaptive-planning", "creative-direction", "project-intake", "result-review", "source-understanding"]
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
    name: first.name,
    purpose: first.purpose,
    status: "completed",
    changeReason: "The only work item is complete.",
    items: [workItem({
      status: "completed",
      review: { required: false, perspective: "combined", criteria: [] },
      approval: "auto",
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
  const context = await new ProjectContextAssembler({ projectStore: store, toolRegistry: registry }).build("demo");

  assert.equal(context.resumeView.activeWorkflowId, workflow.id);
  assert.equal(context.resumeView.activeWorkItemId, "direction");
  assert.equal(context.resumeView.attention[0].purpose, workItem().purpose);
  assert.equal(context.capabilities.capabilities[0].id, "media.inspect");
  assert.equal(context.intelligence.relevantSkills[0].id, "creative-direction");
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
