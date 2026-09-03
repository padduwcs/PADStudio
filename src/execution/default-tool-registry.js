import { createFfprobeMediaInspector } from "../tools/ffprobe-media-inspector.js";
import { ToolRegistry } from "./tool-registry.js";

export function createDefaultToolRegistry(options = {}) {
  return new ToolRegistry([
    createFfprobeMediaInspector(options.ffprobe)
  ]);
}
