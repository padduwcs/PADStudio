import { ToolExecutor } from "../execution/tool-executor.js";
import { createDefaultToolRegistry } from "../execution/default-tool-registry.js";
import { ProjectStore } from "../project/project-store.js";
import { AnalysisService } from "./analysis-service.js";
import { AnalysisStore } from "./analysis-store.js";

export function createDefaultAnalysisService({ rootDir, registry = null } = {}) {
  if (typeof rootDir !== "string" || !rootDir) {
    throw new Error("createDefaultAnalysisService cần project root.");
  }
  const store = new ProjectStore(rootDir);
  const analysisStore = new AnalysisStore({ rootDir, projectStore: store });
  const executor = new ToolExecutor({
    store,
    registry: registry ?? createDefaultToolRegistry()
  });
  return new AnalysisService({ store, analysisStore, executor });
}
