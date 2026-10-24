import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { ChatError } from "./chat-protocol.js";

export const MAX_ATTACHMENT = 10 * 1024 * 1024;
const validId = (id) => typeof id === "string" && /^[0-9a-f-]{36}$/.test(id);
function imageType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

// These are user-selected chat attachments, never PADStudio project resources.
export class ChatAttachments {
  constructor(root) { this.root = root; }
  async put({ name, data } = {}) {
    if (typeof name !== "string" || !name.trim() || name.length > 240 || typeof data !== "string") throw new ChatError(400, "File đính kèm không hợp lệ.");
    if (data.length > Math.ceil(MAX_ATTACHMENT / 3) * 4) throw new ChatError(413, "Mỗi file tối đa 10 MB.");
    if (data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new ChatError(400, "File đính kèm không hợp lệ.");
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > MAX_ATTACHMENT) throw new ChatError(413, "File phải từ 1 byte đến 10 MB.");
    const id = randomUUID();
    const safeName = basename(name.replaceAll("\\", "/")).replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "_").slice(0, 160) || "attachment";
    const mime = imageType(bytes);
    const entry = { id, name: safeName, size: bytes.length, kind: mime ? "image" : "file", mime };
    await mkdir(this.root, { recursive: true });
    await writeFile(join(this.root, `${id}-${safeName}`), bytes, { flag: "wx" });
    await writeFile(join(this.root, id + ".json"), JSON.stringify(entry), { flag: "wx" });
    return entry;
  }
  async get(id) {
    if (!validId(id)) throw new ChatError(400, "Mã file không hợp lệ.");
    let entry;
    try { entry = JSON.parse(await readFile(join(this.root, id + ".json"), "utf8")); }
    catch { throw new ChatError(404, "Không tìm thấy file đính kèm. Hãy chọn lại file."); }
    if (entry.id !== id || typeof entry.name !== "string" || basename(entry.name) !== entry.name || /[\\/]/.test(entry.name)) throw new ChatError(400, "File đính kèm không hợp lệ.");
    return { ...entry, path: join(this.root, `${id}-${entry.name}`) };
  }
  async image(id) {
    const entry = await this.get(id);
    if (entry.kind !== "image") throw new ChatError(415, "Chỉ ảnh mới có bản xem trước.");
    const data = await readFile(entry.path);
    const mime = imageType(data);
    if (!mime) throw new ChatError(415, "Ảnh không hợp lệ.");
    return { data, mime };
  }
}
