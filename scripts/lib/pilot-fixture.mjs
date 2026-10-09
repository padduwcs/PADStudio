import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { validateProjectId } from "../../src/project/project-paths.js";

// The pilot project recorded in reports/phase4-pilot.json was archived after it was accepted, so the acceptance
// scripts look for it in the active store first and then in the archive. They only read it.
export async function locatePilotFixture(projectId) {
  validateProjectId(projectId);
  const choices = [
    { name: "active", root: resolve(".padstudio/projects") },
    { name: "archive", root: resolve(".padstudio/archive/projects") }
  ];
  for (const choice of choices) {
    try {
      await access(resolve(choice.root, projectId, "project.json"));
      return choice;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Không tìm thấy production fixture ở active hoặc archive: ${projectId}`);
}
