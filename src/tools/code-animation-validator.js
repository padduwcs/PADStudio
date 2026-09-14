import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { loadSourcePackage } from "../animation/source-package.js";
import { fail, object, text } from "./asset-tool-common.js";

const RULES = Object.freeze({
  manim: [
    [/(?:^|\n)\s*(?:from|import)\s+(?:os|subprocess|socket|requests|urllib|http|ftplib|shutil|pathlib)\b/u, "host_or_network_module"],
    [/\b(?:open|exec|eval|compile|__import__)\s*\(/u, "dynamic_or_host_io"],
    [/\b(?:os\.|subprocess\.|socket\.|requests\.|urllib\.)/u, "host_or_network_api"],
  ],
  remotion: [
    [/(?:\bfrom\s+|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s*)["'](?:node:)?(?:child_process|fs|net|http|https|dgram|tls|worker_threads)\b/u, "host_or_network_module"],
    [/\b(?:process\.env|eval\s*\(|new\s+Function\s*\()/u, "dynamic_or_environment_access"],
    [/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u, "network_api"],
  ],
  hyperframes: [
    [/<iframe\b|<object\b|<embed\b/iu, "embedded_external_content"],
    [/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u, "network_api"],
    [/\b(?:eval\s*\(|new\s+Function\s*\()/u, "dynamic_code"],
    [/(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu, "external_url"],
  ],
});

function entryFindings(data, entryText) {
  const extension = extname(data.entryFile).toLowerCase();
  if (data.runtime === "manim") {
    if (extension !== ".py") return [{ rule: "entry_extension", message: "Manim entry must be a .py file." }];
    const escaped = data.entrySymbol.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (!new RegExp(`class\\s+${escaped}\\s*\\([^)]*Scene`, "u").test(entryText)) {
      return [{ rule: "entry_symbol", message: "Manim entry symbol must declare a Scene subclass." }];
    }
  }
  if (data.runtime === "remotion") {
    if (![".js", ".jsx", ".ts", ".tsx"].includes(extension)) {
      return [{ rule: "entry_extension", message: "Remotion entry must be JavaScript or TypeScript." }];
    }
    if (!entryText.includes(data.entrySymbol) || !/\b(?:Composition|registerRoot)\b/u.test(entryText)) {
      return [{ rule: "entry_symbol", message: "Remotion entry must expose the named composition/root." }];
    }
  }
  if (data.runtime === "hyperframes") {
    if (data.entryFile.toLowerCase() !== "index.html") return [{ rule: "entry_extension", message: "HyperFrames entry must be index.html." }];
    if (!/<html\b/iu.test(entryText) || !entryText.includes(data.entrySymbol)) {
      return [{ rule: "entry_symbol", message: "HyperFrames entry must be HTML containing the composition identifier." }];
    }
  }
  return [];
}

export function createCodeAnimationValidator() {
  return {
    name: "code-animation-validator", version: "1.0.0", provider: "PADStudio", capability: "animation.validate",
    description: "Validate a managed animation source package without executing its code.",
    runtime: "local", executionMode: "sync", producesFiles: false, approvalRequired: false,
    sideEffects: [], cost: { currency: "USD", estimated: 0 },
    outputDescription: "An animation.validation Result bound to the exact source package checksum.",
    inputSchema: { type: "object", required: ["sourceResultId"], additionalProperties: false,
      properties: { sourceResultId: { type: "string" } } },
    async checkAvailability() { return { status: "available", note: "Static validation does not execute generated code." }; },
    async prepare({ store, projectId, inputs }) {
      object(inputs, ["sourceResultId"]);
      const source = await loadSourcePackage(store, projectId, text(inputs.sourceResultId, "sourceResultId", 150));
      return { runtime: { source }, trace: { sourceResultId: source.result.id } };
    },
    async execute({ source }) {
      const findings = [];
      for (const file of source.files) {
        const content = await readFile(file.filePath, "utf8");
        for (const [pattern, rule] of RULES[source.data.runtime]) {
          if (pattern.test(content)) findings.push({ file: file.path, rule, message: `Blocked construct detected by ${rule}.` });
        }
      }
      const entry = source.files.find((file) => file.path === source.data.entryFile);
      findings.push(...entryFindings(source.data, await readFile(entry.filePath, "utf8")).map((finding) => ({ file: entry.path, ...finding })));
      if (findings.length) {
        fail(`Animation source validation failed: ${findings.map((finding) => `${finding.file}:${finding.rule}`).join(", ")}.`, "unsafe_animation_source");
      }
      return { actualCostUsd: 0, source, findings, warnings: [
        "Static validation is not a security sandbox.",
        "Rendering still requires an exact user approval for this source Result.",
      ] };
    },
    createResult({ execution }) {
      return {
        type: "animation.validation", name: `Validated ${execution.source.result.name}`,
        inputResources: [], inputResults: [execution.source.result.id], inputArtifacts: [], files: [],
        data: { version: "1.0", runtime: execution.source.data.runtime,
          sourceResultId: execution.source.result.id, packageSha256: execution.source.data.packageSha256,
          status: "passed", findings: execution.findings, warnings: execution.warnings,
          validationScope: "static_source_only" },
        verification: { status: "passed", checks: ["source_checksums_verified", "runtime_entry_checked", "blocked_constructs_absent"],
          details: { codeExecuted: false, securityBoundary: "not_a_sandbox" } },
      };
    },
  };
}
