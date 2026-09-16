import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadAnimationProps, normalizeAnimationProps } from "../animation/animation-props.js";
import { fail, fileEvidence, object, primaryFile, text, workspace } from "./asset-tool-common.js";

export function createCodeAnimationProps() {
  return {
    name: "code-animation-props", version: "1.0.0", provider: "PADStudio", capability: "animation.props",
    description: "Create or revise immutable JSON props/data for a code-animation composition.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Writes one immutable animation.props Result inside the current Run output."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.props Result whose JSON file and metadata carry identical normalized data.",
    inputSchema: { type: "object", required: ["operation", "name", "changeSummary", "props"], additionalProperties: false,
      properties: { operation: { enum: ["create", "revise"] }, name: { type: "string", maxLength: 240 },
        changeSummary: { type: "string", maxLength: 2000 }, props: {}, baseResultId: { type: "string" } } },
    async checkAvailability() { return { status: "available", note: "Props packaging does not execute animation code." }; },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      object(inputs, ["operation", "name", "changeSummary", "props", "baseResultId"]);
      if (!["create", "revise"].includes(inputs.operation)) fail("operation must be create or revise.");
      if (inputs.props === undefined) fail("props is required.");
      let base = null;
      if (inputs.operation === "create" && inputs.baseResultId !== undefined) fail("create does not accept baseResultId.");
      if (inputs.operation === "revise") base = await loadAnimationProps(store, projectId, text(inputs.baseResultId, "baseResultId", 150));
      const output = workspace(outputWorkspace);
      let props;
      try { props = normalizeAnimationProps(inputs.props); } catch (error) { fail(error.message); }
      return { runtime: { directory: output.temporaryDirectory, props }, trace: { directory: output.projectRelativeDirectory,
        name: text(inputs.name, "name", 240), changeSummary: text(inputs.changeSummary, "changeSummary", 2000),
        parentPropsResultId: base?.result.id ?? null } };
    },
    async execute({ directory, props }) {
      const path = join(directory, "props.json");
      await writeFile(path, JSON.stringify(props, null, 2) + "\n", "utf8");
      return { actualCostUsd: 0, file: await fileEvidence(path, 1024 * 1024) };
    },
    createResult({ prepared, execution }) {
      return { type: "animation.props", name: prepared.trace.name, inputResources: [],
        inputResults: prepared.trace.parentPropsResultId ? [prepared.trace.parentPropsResultId] : [], inputArtifacts: [],
        files: [primaryFile(prepared, execution, "props.json", "application/json")],
        data: { version: "1.0", props: prepared.runtime.props, parentPropsResultId: prepared.trace.parentPropsResultId,
          changeSummary: prepared.trace.changeSummary },
        verification: { status: "passed", checks: ["json_normalized", "size_bounded", "immutable_result"],
          details: { codeExecuted: false } } };
    },
  };
}
