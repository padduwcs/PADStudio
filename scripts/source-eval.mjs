import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const python = process.env.PADSTUDIO_EVAL_PYTHON || join(root, ".runtime-tools", "source-eval",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
if (!existsSync(python)) {
  console.error("Chưa có môi trường benchmark. Xem eval/source-understanding/README.md để setup.");
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  const child = spawn(python, args[0] === "test"
    ? ["-m", "unittest", "discover", "-s", join(root, "eval/source-understanding"), "-p", "test_*.py", "-v"]
    : ["-I", join(root, "eval/source-understanding/evaluate.py"), ...args],
  { cwd: root, stdio: "inherit", windowsHide: true, shell: false });
  child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
