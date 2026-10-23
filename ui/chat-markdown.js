import { node } from "./dom.js";

export function chatLink(value) {
  if (typeof value !== "string") return null;
  if (/^\/(?:project-results|project-inputs)\//.test(value) && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function inline(parent, source) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of source.matchAll(pattern)) {
    parent.append(document.createTextNode(source.slice(start, match.index)));
    const part = match[0];
    if (part.startsWith("`")) parent.append(node("code", part.slice(1, -1)));
    else if (part.startsWith("**")) parent.append(node("strong", part.slice(2, -2)));
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      const href = chatLink(link[2]);
      if (href) {
        const anchor = node("a", link[1]); anchor.href = href; anchor.target = "_blank"; anchor.rel = "noopener noreferrer";
        parent.append(anchor);
      } else parent.append(document.createTextNode(part));
    }
    start = match.index + part.length;
  }
  parent.append(document.createTextNode(source.slice(start)));
}

// A deliberately small Markdown renderer made entirely from text nodes. Never interpret model output as HTML.
export function renderChatMarkdown(container, source) {
  const fragment = document.createDocumentFragment();
  const lines = String(source ?? "").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\s*```/.test(line)) {
      const language = line.replace(/^\s*```/, "").trim().slice(0, 40);
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      const box = node("div", undefined, "chat-code");
      const bar = node("div", undefined, "chat-code-bar");
      const copy = node("button", "Sao chép", "button button-ghost"); copy.type = "button";
      copy.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(codeLines.join("\n")); copy.textContent = "Đã sao chép"; }
        catch { copy.textContent = "Hãy chọn và sao chép nội dung"; }
      });
      bar.append(node("span", language || "Mã"), copy);
      const pre = node("pre"); pre.append(node("code", codeLines.join("\n")));
      box.append(bar, pre); fragment.append(box); continue;
    }
    const list = /^\s*(?:[-*]\s+|\d+[.)]\s+)/.exec(line);
    if (list) {
      const ordered = /^\s*\d/.test(line);
      const element = node(ordered ? "ol" : "ul");
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        const item = node("li"); inline(item, lines[index++].replace(pattern, "")); element.append(item);
      }
      fragment.append(element); continue;
    }
    const heading = /^#{1,6}\s+/.test(line);
    const paragraph = node(heading ? "h3" : "p");
    const content = [heading ? line.replace(/^#{1,6}\s+/, "") : line];
    index += 1;
    if (!heading) while (index < lines.length && lines[index].trim() && !/^\s*(?:```|[-*]\s|\d+[.)]\s|#{1,6}\s)/.test(lines[index])) content.push(lines[index++]);
    inline(paragraph, content.join("\n")); fragment.append(paragraph);
  }
  container.replaceChildren(fragment);
}
