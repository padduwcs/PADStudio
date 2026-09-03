import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProjectNotFoundError, ProjectReader } from "./project-reader.js";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const applicationRoot = join(currentDirectory, "..");
const uiDirectory = join(applicationRoot, "ui");
const projectRoot = join(applicationRoot, ".padstudio", "projects");

const staticFiles = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" }
};

function sendJson(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

export function createPadStudioServer({ reader }) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/projects") {
        return sendJson(response, 200, { projects: await reader.list() });
      }

      const projectMatch = /^\/api\/projects\/(.+)$/.exec(url.pathname);
      if (request.method === "GET" && projectMatch) {
        const projectId = decodeURIComponent(projectMatch[1]);
        return sendJson(response, 200, { project: await reader.readOverview(projectId) });
      }

      if (request.method === "GET" && staticFiles[url.pathname]) {
        const asset = staticFiles[url.pathname];
        const content = await readFile(join(uiDirectory, asset.file));
        response.writeHead(200, { "Content-Type": asset.type });
        return response.end(content);
      }

      return sendJson(response, 404, { error: "Không tìm thấy." });
    } catch (error) {
      console.error(error);
      if (error instanceof ProjectNotFoundError) {
        return sendJson(response, 404, { error: error.message });
      }
      return sendJson(response, 500, { error: error.message || "Đã có lỗi không xác định." });
    }
  });
}

async function main() {
  const server = createPadStudioServer({ reader: new ProjectReader(projectRoot) });
  const port = Number(process.env.PORT || 7603);

  server.listen(port, "127.0.0.1", () => {
    console.log(`PADStudio đang chạy tại http://127.0.0.1:${port}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}