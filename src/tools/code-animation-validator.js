import { readFile } from "node:fs/promises";
import { extname, posix } from "node:path";
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
    [/\bstaticFile\s*\(/u, "unsupported_static_asset_reference"],
    [/\bsrc\s*=\s*\{?\s*["'](?:\.\/)?assets\//u, "unsupported_unbundled_asset_reference"],
  ],
  hyperframes: [
    [/<iframe\b|<object\b|<embed\b/iu, "embedded_external_content"],
    [/\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u, "network_api"],
    [/\b(?:eval\s*\(|new\s+Function\s*\()/u, "dynamic_code"],
    [/(?:src|href)\s*=\s*["'](?:https?:)?\/\//iu, "external_url"],
  ],
});

const JAVASCRIPT_EXTENSIONS = Object.freeze([".js", ".jsx", ".ts", ".tsx", ".json", ".css", ".svg"]);
const RULE_MESSAGES = Object.freeze({
  unsupported_static_asset_reference: "Remotion staticFile() is not supported for managed PADStudio assets; import the staged ./assets file instead.",
  unsupported_unbundled_asset_reference: "A managed Remotion asset cannot be used as a raw assets/ URL; import the staged file and pass the imported URL.",
  unresolved_local_import: "Relative import is neither a source-package file nor a managed assets/data target.",
});

function localImportSpecifiers(content) {
  const values = [];
  const pattern = /(?:\bimport\s+(?:[^"'`]*?\s+from\s+)?|\bexport\s+[^"'`]*?\s+from\s+|\brequire\s*\(\s*)["']([^"']+)["']/gu;
  for (const match of content.matchAll(pattern)) if (match[1].startsWith(".")) values.push(match[1]);
  return values;
}

function resolvesLocalImport(fromPath, specifier, sourcePaths) {
  const target = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (target === ".." || target.startsWith("../") || target.startsWith("/")) return false;
  if (target === "data/props.json" || target.startsWith("assets/")) return true;
  const extension = posix.extname(target);
  const candidates = extension
    ? [target]
    : [target, ...JAVASCRIPT_EXTENSIONS.map((suffix) => target + suffix), ...JAVASCRIPT_EXTENSIONS.map((suffix) => posix.join(target, "index" + suffix))];
  return candidates.some((candidate) => sourcePaths.has(candidate));
}

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
    name: "code-animation-validator", version: "1.2.0", provider: "PADStudio", capability: "animation.validate",
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
      const sourcePaths = new Set(source.files.map((file) => file.path));
      for (const file of source.files) {
        if (source.data.runtime === "hyperframes" && (file.path.toLowerCase() === "snapshots" || file.path.toLowerCase().startsWith("snapshots/"))) {
          findings.push({ file: file.path, rule: "reserved_runtime_output_path",
            message: "HyperFrames snapshots/ is reserved for runtime-generated preflight evidence." });
        }
        const content = await readFile(file.filePath, "utf8");
        for (const [pattern, rule] of RULES[source.data.runtime]) {
          if (pattern.test(content)) findings.push({ file: file.path, rule, message: RULE_MESSAGES[rule] ?? `Blocked construct detected by ${rule}.` });
        }
        if (source.data.runtime === "remotion") {
          for (const specifier of localImportSpecifiers(content)) {
            if (!resolvesLocalImport(file.path, specifier, sourcePaths)) findings.push({
              file: file.path, rule: "unresolved_local_import", specifier,
              message: `${RULE_MESSAGES.unresolved_local_import} (${specifier})`,
            });
          }
        }
      }
      const entry = source.files.find((file) => file.path === source.data.entryFile);
      findings.push(...entryFindings(source.data, await readFile(entry.filePath, "utf8")).map((finding) => ({ file: entry.path, ...finding })));
      if (findings.length) {
        fail(`Animation source validation failed: ${findings.map((finding) => `${finding.file}:${finding.rule}`).join(", ")}.`, "unsafe_animation_source");
      }
      return { actualCostUsd: 0, source, findings, warnings: [
        "Static validation is not a security sandbox.",
        "Validated source may execute locally during preflight, preview and render without a separate code-approval prompt.",
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
        verification: { status: "passed", checks: ["source_checksums_verified", "runtime_entry_checked", "blocked_constructs_absent",
          ...(execution.source.data.runtime === "remotion" ? ["local_imports_resolved", "managed_asset_references_checked"] : [])],
          details: { codeExecuted: false, securityBoundary: "not_a_sandbox" } },
      };
    },
  };
}
