import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const helperPath = fileURLToPath(new URL("../runtime/analysis/helper.py", import.meta.url));

// Only the Python standard library is needed to load the helper, so any Python 3 will do.
async function findPython() {
  for (const candidate of [process.env.PADSTUDIO_TEST_PYTHON, "python", "python3"].filter(Boolean)) {
    try {
      const { stdout, stderr } = await execFileAsync(candidate, ["--version"], { timeout: 10_000, windowsHide: true });
      if (/Python 3\./.test(stdout + stderr)) return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("padstudio_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.configure_streams()
request = json.load(sys.stdin)
joined = ", ".join(request["glossary"])
joined.encode("utf-8")  # a lone surrogate raises here, as it did inside the tokenizer
print(json.dumps({"glossary": request["glossary"], "joined": joined}, ensure_ascii=False))
`;

function runHelperScript(python, requestBytes) {
  return new Promise((resolve, reject) => {
    // -I ignores PYTHONIOENCODING, which is what a spawned helper sees in production.
    const child = spawn(python, ["-I", "-c", script, helperPath], { windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({
      code, stdout: Buffer.concat(out).toString("utf8"), stderr: Buffer.concat(err).toString("utf8")
    }));
    child.stdin.end(requestBytes);
  });
}

test("the analysis helper reads a UTF-8 request intact, including accented letters the ANSI code page cannot decode", async (t) => {
  const python = await findPython();
  if (!python) {
    t.skip("Python 3 is not available");
    return;
  }
  // "ờ" ends in the byte 0x9D, which Windows-1252 leaves undefined; that byte once became a lone surrogate.
  const glossary = ["mười ba", "lũy thừa nhị phân", "đệ quy", "Binary Exponentiation", "lô ga rít"];
  const { code, stdout, stderr } = await runHelperScript(
    python, Buffer.from(JSON.stringify({ protocolVersion: "1.0", glossary }), "utf8")
  );
  assert.equal(code, 0, stderr);
  const echoed = JSON.parse(stdout);
  assert.deepEqual(echoed.glossary, glossary);
  assert.equal(echoed.joined, glossary.join(", "));
});
