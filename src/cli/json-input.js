import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function parseJsonObject(text) {
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Đầu vào không phải JSON hợp lệ: ${error.message}`, { cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Đầu vào phải là một JSON object.");
  }
  return value;
}

export async function readJsonInput(
  source,
  { baseDirectory = process.cwd(), readInput = readStandardInput } = {}
) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("Thiếu JSON trực tiếp hoặc đường dẫn tới file JSON.");
  }
  const trimmedSource = source.trim();
  if (trimmedSource === "-") return parseJsonObject(await readInput());
  if (trimmedSource.startsWith("{") || trimmedSource.startsWith("[")) {
    return parseJsonObject(trimmedSource);
  }
  return parseJsonObject(await readFile(resolve(baseDirectory, source), "utf8"));
}
