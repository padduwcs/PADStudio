import { lstat, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { command, fail, workspace, fileEvidence, primaryFile } from "./asset-tool-common.js";
import { normalizeGraphic, graphicHtml } from "./graphic-layout.js";

export async function findGraphicBrowser(configured = process.env.PADSTUDIO_BROWSER_PATH?.trim()) {
  const candidates = configured ? [configured] : process.platform === "win32" ? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
  ] : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  for (const path of candidates) { try { if ((await lstat(path)).isFile()) return path; } catch {} }
  return null;
}

export function createBrowserGraphicRenderer({ browserPath, executeCommand = command } = {}) {
  return {
    name: "browser-graphic", version: "1.1.0", provider: "Local browser", capability: "graphic.render",
    description: "Tạo PNG từ thẻ chữ, biểu đồ cột hoặc sơ đồ bước; giữ văn bản/số liệu và từ chối khi không đủ chỗ.",
    runtime: "local-browser", executionMode: "sync", producesFiles: true, approvalRequired: false,
    sideEffects: ["Tạo PNG trong output project, chạy browser headless với profile tạm riêng."], cost: { currency: "USD", estimated: 0 },
    outputDescription: "image.graphic với PNG, nội dung/định dạng, exact artifact references, hash và layout checks.",
    inputSchema: { type: "object", required: ["kind", "title"], additionalProperties: false, properties: {
      kind: { enum: ["card", "bar-chart", "steps"] }, title: { type: "string", maxLength: 240 },
      body: { type: "string", maxLength: 1800, description: "Required for card." },
      items: { type: "array", minItems: 1, maxItems: 8, items: { type: "object", required: ["label", "value"], additionalProperties: false,
        properties: { label: { type: "string", maxLength: 100 }, value: { type: "number", minimum: -1e12, maximum: 1e12 } } } },
      steps: { type: "array", minItems: 2, maxItems: 6, items: { type: "string", maxLength: 240 } },
      width: { type: "integer", minimum: 320, maximum: 3840, multipleOf: 2, default: 1280 },
      height: { type: "integer", minimum: 320, maximum: 3840, multipleOf: 2, default: 720 },
      theme: { enum: ["dark", "light"], default: "dark" }, accent: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      typography: { type: "object", additionalProperties: false, properties: { font: { enum: ["Segoe UI", "Arial", "Tahoma", "Verdana"] }, titleWeight: { enum: [400,500,600,700] }, lineSpacing: { type: "number", minimum: 1, maximum: 2 } } },
      footer: { type: "string", maxLength: 240 }, artifactIds: { type: "array", maxItems: 20, uniqueItems: true, items: { type: "string" } }
    } },
    async checkAvailability() {
      const executable = await findGraphicBrowser(browserPath);
      return executable ? { status: "available", executable, note: "Browser/font execution is validated when rendering." }
        : { status: "unavailable", reason: "Install Chrome/Edge/Chromium or set PADSTUDIO_BROWSER_PATH." };
    },
    async prepare({ store, projectId, inputs, outputWorkspace, signal }) {
      const { spec, artifactIds, qualityFindings } = normalizeGraphic(inputs);
      const known = new Set((await store.readArtifacts(projectId)).map((item) => item.id));
      if (artifactIds.some((id) => !known.has(id))) fail("Graphic references an unknown artifact.");
      const output = workspace(outputWorkspace);
      return { runtime: { spec, qualityFindings, directory: output.temporaryDirectory, signal },
        trace: { directory: output.projectRelativeDirectory, artifactIds } };
    },
    async execute({ spec, qualityFindings, directory, signal, availability }) {
      const page = join(directory, "graphic.html"), png = join(directory, "graphic.png"), profile = join(directory, "browser-profile");
      await writeFile(page, graphicHtml(spec), "utf8");
      let layout;
      try {
        const result = await executeCommand(availability.executable, [
          "--headless=new", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync",
          "--no-first-run", "--no-default-browser-check", "--hide-scrollbars", "--force-device-scale-factor=1",
          "--user-data-dir=" + profile, "--window-size=" + spec.width + "," + spec.height,
          "--screenshot=" + png, "--dump-dom", "--timeout=15000", "--virtual-time-budget=1000", pathToFileURL(page).href
        ], { timeout: 25000, signal });
        const encoded = result.stdout.match(/<meta name="padstudio-render" content="([A-Za-z0-9+/=]+)">/)?.[1];
        try { layout = JSON.parse(Buffer.from(encoded ?? "", "base64").toString("utf8")); } catch { fail("Browser did not return layout verification.", "invalid_output"); }
        if (layout?.status !== "passed") fail(layout?.error || "Graphic layout failed.", "layout_overflow");
      } finally {
        await rm(page, { force: true });
        // directory comes exclusively from the executor's owned output workspace.
        await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
      const file = await fileEvidence(png, 64 * 1024 * 1024);
      const header = await readFile(png);
      if (!header.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
          header.length < 24 || header.readUInt32BE(16) !== spec.width || header.readUInt32BE(20) !== spec.height) fail("Graphic PNG dimensions are incorrect.", "invalid_output");
      return { file, layout, actualCostUsd: 0, verification: { status: "passed", checks: ["canvas_rendered", "text_fits_bounds", "visual_quality_contract", "png_dimensions", "output_sha256"],
        details: { layout, visualQuality: { status: qualityFindings.length ? "warnings" : "passed", findings: qualityFindings },
          creativeReview: "not_performed", fontPortability: "System font selection may differ across machines." } } };
    },
    createResult({ prepared, execution }) {
      return { type: "image.graphic", name: prepared.runtime.spec.title, inputResources: [], inputResults: [],
        inputArtifacts: prepared.trace.artifactIds, files: [primaryFile(prepared, execution, "graphic.png", "image")],
        data: { graphic: prepared.runtime.spec, resolution: { width: prepared.runtime.spec.width, height: prepared.runtime.spec.height }, contentReview: "not_performed" },
        verification: execution.verification };
    }
  };
}
