/** What a message keeps from English once names, code and units are set aside. */
import { readFileSync } from "node:fs";

const CONFIG = JSON.parse(readFileSync(new URL("../../../../../tooling/i18n/scan.config.json", import.meta.url), "utf8")) as { brands: string[]; acronyms: string[] };

/** Names kept as they are in every language. */
const KEEP = [
  ...CONFIG.brands,
  ...CONFIG.acronyms,
  "Ask Lyko", "The Fold", "The Forge", "The League", "Harbour", "Ledger", "Scent", "Tag", "Outrun", "Lykaion", "LykiaAccount", "Passkey", "passkey",
];

/** What is left of a message once parameters, names, tokens and code are removed. */
export function wordsLeft(text: string): string {
  let rest = text.replace(/\{[^{}]*\}/gu, " ");
  rest = rest.replace(/\b[\w.-]+\.(?:com|ts|json|md|txt|io|org)\b|\bhttps?:\S+|\/[\w/:.{}-]+|`[^`]*`|\b[A-Z0-9_]{2,}\b|\b0x[0-9a-fA-F]+\b|\b[\w-]+\(\)|\b\w+\.\w+(?:\.\w+)*\b/gu, " ");
  for (const k of [...KEEP].sort((a, b) => b.length - a.length)) rest = rest.split(k).join(" ");
  return rest.replace(/[^\p{L}]+/gu, " ").trim();
}

