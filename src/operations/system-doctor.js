import { constants } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { ProjectContextAssembler } from "../intelligence/project-context-assembler.js";
import { ProjectStore } from "../project/project-store.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";

export const PRACTICAL_REQUIRED_CAPABILITIES = Object.freeze([
  "media.inspect",
  "source.probe",
  "video.detect-scenes",
  "source.extract-frames",
  "audio.analyze",
  "audio.transcribe",
  "source.preview",
  "video.render-sequence",
  "video.export-delivery"
]);

function remediation(code, message) {
  return { code, message };
}

async function deepIntegrity(store, projectId, context) {
  const files = [];
  for (const result of context.results) {
    for (const file of result.files) {
      try {
        const verified = await store.verifyResultFile(
          projectId, result.id, file.id, { requireChecksum: false }
        );
        files.push({
          resultId: result.id,
          fileId: file.id,
          status: verified.integrity,
          sha256: verified.sha256
        });
      } catch (error) {
        files.push({
          resultId: result.id,
          fileId: file.id,
          status: "failed",
          error: error.message
        });
      }
    }
  }
  return {
    checked: files.length,
    verified: files.filter((file) => file.status === "verified").length,
    unchecked: files.filter((file) => file.status === "unchecked").length,
    failed: files.filter((file) => file.status === "failed").length,
    files
  };
}

export async function inspectPadStudio({
  rootDir,
  deep = false,
  projectId = null,
  registry = createDefaultToolRegistry(),
  store = new ProjectStore(rootDir),
  minimumFreeBytes = 1024 ** 3
}) {
  const remediations = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const runtime = {
    node: process.version,
    nodeMinimum: 20,
    nodeReady: nodeMajor >= 20,
    platform: process.platform,
    architecture: process.arch
  };
  if (!runtime.nodeReady) {
    remediations.push(remediation("node_version", "Cài Node.js 20 trở lên rồi chạy lại doctor."));
  }

  let storage;
  try {
    await access(rootDir, constants.R_OK | constants.W_OK);
    const disk = await statfs(rootDir);
    const freeBytes = Number(disk.bavail) * Number(disk.bsize);
    storage = {
      rootDir,
      readable: true,
      writable: true,
      freeBytes,
      minimumFreeBytes,
      ready: freeBytes >= minimumFreeBytes
    };
    if (!storage.ready) {
      remediations.push(remediation(
        "disk_space",
        "Giải phóng tối thiểu " + minimumFreeBytes + " byte trên volume chứa project."
      ));
    }
  } catch (error) {
    storage = {
      rootDir, readable: false, writable: false, freeBytes: null,
      minimumFreeBytes, ready: false, error: error.message
    };
    remediations.push(remediation(
      "project_root_access",
      "Tạo project root và cấp quyền đọc/ghi cho user đang chạy PADStudio."
    ));
  }

  const described = await registry.describeCapabilities();
  const required = new Set(PRACTICAL_REQUIRED_CAPABILITIES);
  const capabilities = described.capabilities.map((capability) => ({
    id: capability.id,
    requirement: required.has(capability.id) ? "required" : "optional",
    available: capability.available,
    tools: capability.tools.map((tool) => ({
      name: tool.name,
      provider: tool.provider,
      status: tool.availability.status,
      reason: tool.availability.reason ?? null
    }))
  }));
  const missingRequired = PRACTICAL_REQUIRED_CAPABILITIES.filter((id) =>
    !capabilities.some((capability) => capability.id === id && capability.available)
  );
  for (const id of missingRequired) {
    remediations.push(remediation(
      "capability:" + id,
      "Khôi phục runtime/profile của capability " + id + "; doctor không tự fallback."
    ));
  }

  const projects = [];
  if (storage.readable) {
    const availableProjects = await store.listProjects();
    const selected = projectId
      ? availableProjects.filter((project) => project.id === projectId)
      : availableProjects;
    if (projectId && selected.length === 0) {
      remediations.push(remediation("project_not_found", "Kiểm tra lại project id: " + projectId));
    }
    for (const project of selected) {
      try {
        const context = await new ProjectContextAssembler({ projectStore: store }).build(project.id);
        const integrity = deep ? await deepIntegrity(store, project.id, context) : null;
        const status = integrity?.failed
          ? "blocked"
          : integrity?.unchecked ? "attention" : context.health.status;
        projects.push({
          id: project.id,
          title: project.title,
          status,
          health: context.health,
          integrity
        });
        if (status !== "ready") {
          remediations.push(remediation(
            "project:" + project.id,
            "Đọc health/issue của project " + project.id + " và xử lý trước khi tiếp tục."
          ));
        }
      } catch (error) {
        projects.push({
          id: project.id, title: project.title, status: "blocked",
          health: null, integrity: null, error: error.message
        });
        remediations.push(remediation(
          "project:" + project.id,
          "Project không assemble được; giữ nguyên dữ liệu và kiểm tra record/path được báo lỗi."
        ));
      }
    }
  }

  const systemBlocked = !runtime.nodeReady || !storage.ready || missingRequired.length > 0;
  const projectAttention = projects.some((project) => project.status !== "ready") ||
    Boolean(projectId && !projects.length);
  return {
    version: "1.0",
    checkedAt: new Date().toISOString(),
    status: systemBlocked ? "blocked" : projectAttention ? "attention" : "ready",
    mode: deep ? "deep" : "quick",
    runtime,
    storage,
    capabilities,
    missingRequiredCapabilities: missingRequired,
    projects,
    remediations,
    release: {
      practicalDefault: "owner-machine",
      releaseDefault: null,
      note: "Practical readiness không chứng nhận các release gate/corpus/benchmark chưa đo."
    }
  };
}
