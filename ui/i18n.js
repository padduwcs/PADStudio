import { EN_MESSAGES, translateApplicationMessage } from "./messages-en.js";

export const LANGUAGES = Object.freeze(["vi", "en"]);
let language = "vi";
try {
  const saved = globalThis.localStorage?.getItem("padstudio-language");
  if (LANGUAGES.includes(saved)) language = saved;
} catch { /* A language preference is optional. */ }
if (globalThis.location) {
  const requested = new URL(globalThis.location.href).searchParams.get("lang");
  if (LANGUAGES.includes(requested)) language = requested;
}

export function getLanguage() { return language; }

export function setLanguage(value) {
  if (!LANGUAGES.includes(value)) return false;
  language = value;
  try { globalThis.localStorage?.setItem("padstudio-language", value); } catch { /* Optional preference. */ }
  return true;
}

// Only application-owned copy is passed here. Project names, prompts, answers, files and transcripts stay verbatim.
export function t(source, ...values) {
  const text = language === "en" ? Object.hasOwn(EN_MESSAGES, source) ? EN_MESSAGES[source] : translateApplicationMessage(source) : source;
  return values.length ? text.replace(/\{(\d+)\}/g, (match, index) => index < values.length ? String(values[index]) : match) : text;
}

export function localizeStatic(root = document) {
  root.documentElement.lang = language;
  for (const element of root.querySelectorAll("[data-i18n]")) element.textContent = t(element.textContent);
  for (const element of root.querySelectorAll("[data-i18n-attrs]")) {
    for (const attribute of element.dataset.i18nAttrs.split(" ")) element.setAttribute(attribute, t(element.getAttribute(attribute)));
  }
}
