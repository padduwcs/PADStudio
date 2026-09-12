import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectPadStudio,
  PRACTICAL_REQUIRED_CAPABILITIES
} from "../src/operations/system-doctor.js";
import { ProjectStore } from "../src/project/project-store.js";

function registryWithout(missing = null) {
  return {
    describeCapabilities: async () => ({
      capabilities: [
        ...PRACTICAL_REQUIRED_CAPABILITIES
          .filter((id) => id !== missing)
          .map((id) => ({
            id, available: true,
            tools: [{ name: id, provider: "fixture", availability: { status: "available" } }]
          })),
        {
          id: "optional.fixture", available: false,
          tools: [{
            name: "optional", provider: "fixture",
            availability: { status: "unavailable", reason: "not installed" }
          }]
        }
      ]
    })
  };
}

test("system doctor keeps optional tools non-blocking and reports release limits", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir, { recursive: true });
  const result = await inspectPadStudio({
    rootDir,
    registry: registryWithout(),
    store: new ProjectStore(rootDir),
    minimumFreeBytes: 0
  });
  assert.equal(result.status, "ready");
  assert.equal(result.release.releaseDefault, null);
  assert.equal(
    result.capabilities.find((entry) => entry.id === "optional.fixture").requirement,
    "optional"
  );
});

test("system doctor blocks when a required practical capability is missing", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "padstudio-doctor-blocked-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const rootDir = join(workspace, "projects");
  await mkdir(rootDir, { recursive: true });
  const missing = PRACTICAL_REQUIRED_CAPABILITIES[0];
  const result = await inspectPadStudio({
    rootDir,
    registry: registryWithout(missing),
    store: new ProjectStore(rootDir),
    minimumFreeBytes: 0
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.missingRequiredCapabilities, [missing]);
  assert.ok(result.remediations.some((entry) => entry.code === "capability:" + missing));
});
