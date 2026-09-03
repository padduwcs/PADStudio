import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function readStandardInput() {
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

function parseRequest(text) {
  let request;
  try {
    request = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw new Error(`Yêu cầu công cụ không phải JSON hợp lệ: ${error.message}`, {
      cause: error
    });
  }
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new Error("Yêu cầu công cụ phải là một JSON object.");
  }
  return request;
}

export async function readToolRequest(
  source,
  { baseDirectory = process.cwd(), readInput = readStandardInput } = {}
) {
  if (typeof source !== "string" || source.trim() === "") {
    throw new Error("Thiếu JSON trực tiếp hoặc đường dẫn tới file request.");
  }
  const trimmedSource = source.trim();
  if (trimmedSource === "-") {
    return parseRequest(await readInput());
  }
  if (trimmedSource.startsWith("{") || trimmedSource.startsWith("[")) {
    return parseRequest(trimmedSource);
  }
  const requestText = await readFile(resolve(baseDirectory, source), "utf8");
  return parseRequest(requestText);
}
