import { node } from "./dom.js";

export function chatLink(value) {
  if (typeof value !== "string") return null;
  if (/^\/(?:project-results|project-inputs)\//.test(value) && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function inline(parent, source, depth = 0) {
  if (depth > 8) { parent.append(document.createTextNode(source)); return; }
  const pattern = /(`[^`\n]+`|\*\*[^\n]+?\*\*|__[^\n]+?__|~~[^\n]+?~~|\*[^*\n]+\*|(?<!\w)_[^_\n]+_(?!\w)|\[[^\]\n]+\]\([^\s)]+\))/g;
  let start = 0;
  for (const match of source.matchAll(pattern)) {
    parent.append(document.createTextNode(source.slice(start, match.index)));
    const part = match[0];
    if (part.startsWith("`")) parent.append(node("code", part.slice(1, -1)));
    else if (/^(?:\*\*|__|~~)/.test(part)) { const element = node(part.startsWith("~~") ? "del" : "strong"); inline(element, part.slice(2, -2), depth + 1); parent.append(element); }
    else if (/^[*_]/.test(part)) { const element = node("em"); inline(element, part.slice(1, -1), depth + 1); parent.append(element); }
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
export function renderChatMarkdown(container, source, depth = 0) {
  const fragment = document.createDocumentFragment();
  const lines = String(source ?? "").split("\n");
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { fragment.append(node("hr")); index += 1; continue; }
    if (/^\s*>/.test(line) && depth < 12) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*> ?/, ""));
      const block = node("blockquote"); renderChatMarkdown(block, quote.join("\n"), depth + 1); fragment.append(block); continue;
    }
    if (line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || "")) {
      const cells = (value) => value.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((cell) => cell.trim().replaceAll("\\|", "|"));
      const wrap = node("div", undefined, "chat-table"); const table = node("table"); const head = node("thead"); const row = node("tr");
      const headers = cells(line); for (const value of headers) { const cell = node("th"); cell.scope = "col"; inline(cell, value); row.append(cell); } head.append(row); table.append(head);
      const body = node("tbody"); index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        const row = node("tr"); const values = cells(lines[index++]); for (let i = 0; i < headers.length; i++) { const cell = node("td"); inline(cell, values[i] || ""); row.append(cell); } body.append(row);
      }
      table.append(body); wrap.append(table); fragment.append(wrap); continue;
    }
    if (/^\s*(?:```|~~~)/.test(line)) {
      const fence = line.trim().slice(0, 3);
      const language = line.trim().slice(3).trim().slice(0, 40);
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith(fence)) codeLines.push(lines[index++]);
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
      const stack = [{ indent: /^\s*/.exec(line)[0].length, list: element }];
      while (index < lines.length && /^\s*(?:[-*]\s+|\d+[.)]\s+)/.test(lines[index])) {
        const current = lines[index++]; const indent = /^\s*/.exec(current)[0].length;
        while (stack.length > 1 && indent < stack.at(-1).indent) stack.pop();
        let target = stack.at(-1).list;
        if (indent > stack.at(-1).indent && indent > 0 && target.lastElementChild) {
          const nested = node(/^\s*\d/.test(current) ? "ol" : "ul"); target.lastElementChild.append(nested); stack.push({ indent, list: nested }); target = nested;
        }
        const item = node("li"); let content = current.replace(/^\s*(?:[-*]\s+|\d+[.)]\s+)/, "");
        if (/^\[[ xX]\]\s/.test(content)) { const check = node("input"); check.type = "checkbox"; check.checked = /^\[[xX]\]/.test(content); check.disabled = true; item.className = "chat-task"; item.append(check); content = content.slice(4); }
        inline(item, content); target.append(item);
      }
      fragment.append(element); continue;
    }
    const heading = /^#{1,6}\s+/.test(line);
    const paragraph = node(heading ? "h3" : "p");
    const content = [heading ? line.replace(/^#{1,6}\s+/, "") : line];
    index += 1;
    if (!heading) while (index < lines.length && lines[index].trim() && !/^\s*(?:```|~~~|>|[-*]\s|\d+[.)]\s|#{1,6}\s)/.test(lines[index]) && !(lines[index].includes("|") && /^\s*\|?\s*:?-{3}/.test(lines[index + 1] || ""))) content.push(lines[index++]);
    inline(paragraph, content.join("\n")); fragment.append(paragraph);
  }
  container.replaceChildren(fragment);
}
