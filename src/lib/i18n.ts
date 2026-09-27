import type { Language } from "../types";
import { EN } from "./i18n-en.ts";

/**
 * Tiny i18n: Portuguese is the source language and each Portuguese string is its
 * own key, so `t("Atualizar uso agora")` reads naturally in the code and falls
 * back to Portuguese when a translation is missing. `{name}` placeholders are
 * filled from `values`. A test checks that every t() key in src has an English entry.
 */
export type Locale = "pt" | "en";

let current: Locale = "pt";

export function resolveLanguage(language: Language, browser = typeof navigator === "undefined" ? "pt" : navigator.language): Locale {
  if (language === "pt" || language === "en") return language;
  return browser.toLowerCase().startsWith("pt") ? "pt" : "en";
}

export function setLocale(locale: Locale) {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** BCP 47 tag for Intl formatting. */
export function intlLocale() {
  return current === "en" ? "en-US" : "pt-BR";
}

function fill(text: string, values?: Record<string, string | number>) {
  if (!values) return text;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

export function t(text: string, values?: Record<string, string | number>) {
  const translated = current === "en" ? EN[text] ?? text : text;
  return fill(translated, values);
}

/** Messages that the Rust side sends with a variable part. */
const DYNAMIC: [RegExp, string][] = [
  [/^(.+) retornou HTTP (\d+)\.$/, "{1} returned HTTP {2}."],
  [/^Claude Web recusou a consulta \(HTTP 403\): (.+)$/, "Claude Web refused the request (HTTP 403): {1}"],
  [/^A instalação do Claude Code falhou: (.+)$/, "The Claude Code install failed: {1}"],
  [/^A desinstalação falhou: (.+)$/, "The uninstall failed: {1}"],
  [/^Tela (\d+)$/, "Display {1}"]
];

/** Translates a message that came from the Rust side (errors, provider notes). */
export function tr(message: string | null | undefined): string {
  if (!message) return "";
  if (current === "pt") return message;
  if (EN[message]) return EN[message];
  for (const [pattern, template] of DYNAMIC) {
    const match = message.match(pattern);
    if (match) return template.replace(/\{(\d)\}/g, (_, index: string) => match[Number(index)] ?? "");
  }
  return message;
}

const LABEL_WORDS: [RegExp, string][] = [
  [/Sessão/g, "Session"],
  [/Semanal/g, "Weekly"],
  [/semanal/g, "weekly"],
  [/Uso incluído/g, "Included usage"],
  [/Uso de API/g, "API usage"],
  [/Sob demanda/g, "On-demand"],
  [/Ilimitado/g, "Unlimited"]
];

/** Translates a quota window label from the Rust side ("Sessão · 5h", "Opus · semanal"). */
export function trLabel(label: string) {
  if (current === "pt") return label;
  return LABEL_WORDS.reduce((text, [pattern, word]) => text.replace(pattern, word), label);
}
