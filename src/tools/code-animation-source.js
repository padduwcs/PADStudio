import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { ANIMATION_RUNTIMES } from "../animation/animation-composition.js";
import {
  MAX_SOURCE_FILES, MAX_SOURCE_FILE_BYTES, MAX_SOURCE_PACKAGE_BYTES,
  loadSourcePackage, safeSourcePath, sourceMediaType,
} from "../animation/source-package.js";
import { fileEvidence, primaryFile, workspace, fail, object, text } from "./asset-tool-common.js";

function normalizeDependencies(value = []) {
  if (!Array.isArray(value) || value.length > 50) fail("dependencies must be an array with at most 50 entries.");
  const dependencies = value.map((item, index) => {
    object(item, ["name", "version", "integrity"], `dependencies[${index}]`);
    const version = text(item.version, `dependencies[${index}].version`, 200);
    if (/^(?:latest|next|dev|main|master)$/iu.test(version) || /^[~^*<>=]/u.test(version) || /\s\|\||\s-\s/u.test(version)) {
      fail(`dependencies[${index}].version must be an exact version or immutable identifier.`);
    }
    return {
      name: text(item.name, `dependencies[${index}].name`, 200),
      version,
      integrity: item.integrity == null ? null : text(item.integrity, `dependencies[${index}].integrity`, 500),
    };
  });
  if (new Set(dependencies.map((item) => item.name)).size !== dependencies.length) fail("Dependency names must be unique.");
  return dependencies;
}

function normalizeTextFile(value, label) {
  object(value, ["path", "content"], label);
  const path = safeSourcePath(value.path, `${label}.path`);
  if (typeof value.content !== "string") fail(`${label}.content must be text.`);
  const bytes = Buffer.byteLength(value.content, "utf8");
  if (!bytes || bytes > MAX_SOURCE_FILE_BYTES) fail(`${label}.content must be 1-${MAX_SOURCE_FILE_BYTES} UTF-8 bytes.`);
  return { path, content: value.content.replaceAll("\r\n", "\n").normalize("NFC"), bytes };
}

function fileId(index) { return `source-${String(index + 1).padStart(3, "0")}`; }

export function createCodeAnimationSource() {
  return {
    name: "code-animation-source", version: "1.0.0", provider: "PADStudio", capability: "animation.source",
    description: "Create or revise an immutable animation source package without executing its code.",
    runtime: "local", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Writes a new immutable source-package Result inside the current Run output."],
    cost: { currency: "USD", estimated: 0 },
    outputDescription: "animation.source-package containing normalized source files, manifest, dependency declarations and revision provenance.",
    // A revision continues its base package, so only a new package has to name the runtime and entry again.
    inputSchema: { type: "object", required: ["operation", "name", "changeSummary"], additionalProperties: false,
      allOf: [{ if: { properties: { operation: { const: "create" } } }, then: { required: ["runtime", "entryFile", "entrySymbol"] } }],
      properties: {
      operation: { enum: ["create", "revise"] }, runtime: { enum: [...ANIMATION_RUNTIMES] }, name: { type: "string", maxLength: 240 },
      entryFile: { type: "string", maxLength: 300 }, entrySymbol: { type: "string", maxLength: 240 }, changeSummary: { type: "string", maxLength: 2000 },
      files: { type: "array", maxItems: MAX_SOURCE_FILES, items: { type: "object", required: ["path", "content"] } },
      baseResultId: { type: "string" },
      changes: { type: "array", maxItems: MAX_SOURCE_FILES, items: { type: "object", required: ["path"], additionalProperties: false,
        properties: { path: { type: "string" }, content: { type: ["string", "null"] } } } },
      dependencies: { type: "array", maxItems: 50, items: { type: "object" } }
    } },
    async checkAvailability() { return { status: "available", note: "Source packaging does not execute generated code." }; },
    async prepare({ store, projectId, inputs, outputWorkspace }) {
      object(inputs, ["operation", "runtime", "name", "entryFile", "entrySymbol", "changeSummary", "files", "baseResultId", "changes", "dependencies"]);
      const operation = inputs.operation;
      // Only a revision may leave the runtime out: it is taken from the base package it continues.
      if ((operation !== "revise" || inputs.runtime !== undefined) && !ANIMATION_RUNTIMES.includes(inputs.runtime)) {
        fail("runtime must be manim, remotion or hyperframes.");
      }
      if (!["create", "revise"].includes(operation)) fail("operation must be create or revise.");
      const output = workspace(outputWorkspace);
      let base = null;
      let sourceFiles;
      if (operation === "create") {
        if (inputs.baseResultId !== undefined || inputs.changes !== undefined) fail("create does not accept baseResultId or changes.");
        if (!Array.isArray(inputs.files) || !inputs.files.length) fail("create requires files.");
        sourceFiles = inputs.files.map((file, index) => normalizeTextFile(file, `files[${index}]`));
      } else {
        if (inputs.files !== undefined) fail("revise accepts changes, not files.");
        base = await loadSourcePackage(store, projectId, text(inputs.baseResultId, "baseResultId", 150), inputs.runtime ?? null);
        if (!Array.isArray(inputs.changes) || !inputs.changes.length) fail("revise requires at least one change.");
        const byPath = new Map();
        for (const file of base.files) byPath.set(file.path, { path: file.path, filePath: file.filePath, bytes: file.sizeBytes });
        for (let index = 0; index < inputs.changes.length; index += 1) {
          const change = inputs.changes[index];
          object(change, ["path", "content"], `changes[${index}]`);
          const path = safeSourcePath(change.path, `changes[${index}].path`);
          if (change.content === null) byPath.delete(path);
          else byPath.set(path, normalizeTextFile({ path, content: change.content }, `changes[${index}]`));
        }
        sourceFiles = [...byPath.values()];
      }
      const runtimeName = inputs.runtime ?? base.data.runtime;
      const entryFile = safeSourcePath(inputs.entryFile ?? base?.data.entryFile, "entryFile");
      const entrySymbol = text(inputs.entrySymbol ?? base?.data.entrySymbol, "entrySymbol", 128);
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(entrySymbol)) fail("entrySymbol must be a safe runtime identifier.");
      if (!sourceFiles.length || sourceFiles.length > MAX_SOURCE_FILES) fail("Source package must contain 1-64 files.");
      if (new Set(sourceFiles.map((file) => file.path.toLowerCase())).size !== sourceFiles.length) fail("Source paths must be unique (case-insensitive).");
      if (!sourceFiles.some((file) => file.path === entryFile)) fail("entryFile must exist in the source package.");
      const totalBytes = sourceFiles.reduce((sum, file) => sum + file.bytes, 0);
      if (totalBytes > MAX_SOURCE_PACKAGE_BYTES) fail(`Source package exceeds ${MAX_SOURCE_PACKAGE_BYTES} bytes.`);
      return {
        runtime: { directory: output.temporaryDirectory, sourceFiles, base },
        trace: { directory: output.projectRelativeDirectory, operation, runtime: runtimeName,
          name: text(inputs.name, "name", 240), entryFile, entrySymbol,
          changeSummary: text(inputs.changeSummary, "changeSummary", 2000),
          dependencies: normalizeDependencies(inputs.dependencies ?? base?.data.dependencies ?? []) }
      };
    },
    async execute({ directory, sourceFiles }) {
      const written = [];
      for (const source of [...sourceFiles].sort((left, right) => left.path.localeCompare(right.path))) {
        const target = join(directory, "source", ...source.path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        if (source.filePath) await copyFile(source.filePath, target);
        else await writeFile(target, source.content, "utf8");
        written.push({ path: source.path, target, ...(await fileEvidence(target, MAX_SOURCE_FILE_BYTES)) });
      }
      const packageSha256 = createHash("sha256");
      for (const file of written) packageSha256.update(`${file.path}\0${file.sha256}\0`);
      return { written, packageSha256: packageSha256.digest("hex"), actualCostUsd: 0 };
    },
    async createResult({ prepared, execution }) {
      const sourceFiles = execution.written.map((file, index) => ({ path: file.path, fileId: fileId(index), sizeBytes: file.sizeBytes, sha256: file.sha256 }));
      const manifest = { version: "1.0", runtime: prepared.trace.runtime, entryFile: prepared.trace.entryFile,
        entrySymbol: prepared.trace.entrySymbol, dependencies: prepared.trace.dependencies, sourceFiles, packageSha256: execution.packageSha256,
        parentSourceResultId: prepared.runtime.base?.result.id ?? null, changeSummary: prepared.trace.changeSummary };
      const manifestPath = join(prepared.runtime.directory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
      const manifestEvidence = await fileEvidence(manifestPath, 2 * 1024 * 1024);
      return {
        type: "animation.source-package", name: prepared.trace.name,
        inputResources: [], inputResults: prepared.runtime.base ? [prepared.runtime.base.result.id] : [], inputArtifacts: [],
        files: [
          primaryFile(prepared, { file: manifestEvidence }, "manifest.json", "application/json"),
          ...execution.written.map((file, index) => ({ id: fileId(index), role: "source", path: `${prepared.trace.directory}/source/${file.path}`,
            name: file.path, mediaType: sourceMediaType(file.path), sizeBytes: file.sizeBytes, sha256: file.sha256 })),
        ],
        data: manifest,
        verification: { status: "passed", checks: ["safe_relative_paths", "utf8_source", "entry_present", "package_sha256", "immutable_result"],
          details: { codeExecuted: false, sourceReview: "not_performed" } },
      };
    },
  };
}
