// Run every isolated browser acceptance suite in the same order locally and in CI.
// Each suite owns a temporary store/config and launches its own disposable browser.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["Observer: empty workspace", "ui-empty-acceptance.mjs"],
  ["Observer: real media", "ui-live-acceptance.mjs"],
  ["Observer: machine settings", "ui-tools-acceptance.mjs", "--shots", ".cache/tools-ui"],
  ["Workspace: home and languages", "ui-workspace-acceptance.mjs"],
  ["Chat: independent tabs and resizing", "ui-chat-acceptance.mjs"],
  ["Chat: native features and menus", "ui-chat-features.mjs"]
];

for (const [title, script, ...args] of suites) {
  console.log(`\n${title}`);
  const result = spawnSync(process.execPath, [resolve(root, "scripts", script), ...args], {
    cwd: root, stdio: "inherit", windowsHide: true
  });
  if (result.error || result.signal || result.status !== 0) {
    console.error(`${title}: failed${result.error ? " (" + result.error.message + ")" : ""}`);
    process.exit(result.status || 1);
  }
}
console.log("\nUI acceptance: all 6 suites passed.");
