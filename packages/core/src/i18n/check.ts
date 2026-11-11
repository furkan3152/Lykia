/**
 * The "never mixed" check: does a text read as one language? Used by the
 * per-language conversation suite (API answers) and the rendered-page check
 * (the web app), with the same rules. Names Lykia keeps in every language
 * (brands, tokens, chains, protocols), code, addresses and figures are set
 * aside first; what is left must not carry another language's words.
 */
import type { Locale } from "../locale.js";

/** Kept as they are in every language. */
export const KEPT_NAMES: readonly string[] = [
  "Lykia", "Lyko", "Ask Lyko", "Ask", "The Fold", "The League", "The Forge", "Fold", "Forge", "Fence", "Leash", "Leashes", "Whistle", "Stile", "Autopilot", "Herding", "Flock", "Trails", "Pack", "League", "the League", "Harbour", "Ledger", "Letoon", "Scent", "Tag", "Outrun", "Lykaion", "Mosaic", "LykiaAccount", "LykiaOrders", "LykiaRouter",
  "USDC", "EURC", "cirBTC", "WETH", "ETH", "BTC", "USYC", "Bitcoin", "Ethereum", "Arc", "Arc Network", "Base", "Arbitrum", "Optimism", "OP Mainnet", "Avalanche", "Polygon", "Solana", "Unichain", "Linea", "Sonic", "World Chain", "Codex", "Sei", "Ink", "Plume", "BNB Chain",
  "Circle", "CCTP", "Gateway", "Morpho", "Aave", "Aave V4", "Uniswap", "Aerodrome", "Across", "Relay", "Chainlink", "Pyth", "Extended", "Telegram", "GitHub", "Galaxy", "Steakhouse", "Gauntlet", "Keyrock", "Bitwise", "Curve", "Synthra", "Arcscan", "Passkey", "passkey", "mainnet", "testnet", "Mainnet", "Testnet",
  "API", "SDK", "MCP", "APY", "APR", "DCA", "TWAP", "RPC", "ID", "IDs", "JSON", "URL", "HTTP", "Webhook", "webhook", "Webhooks", "webhooks", "Stop", "Revoke", "Pause", "Resume",
];

const ENGLISH_WORDS = ["the", "and", "your", "you", "with", "this", "that", "these", "those", "from", "will", "can't", "cannot", "don't", "won't", "isn't", "it's", "is", "are", "was", "were", "be", "been", "have", "has", "for", "of", "to", "it", "or", "by", "at", "if", "an", "but", "what", "when", "which", "who", "how", "why", "there", "here", "into", "only", "then", "than", "every", "each", "nothing", "something", "before", "after", "under", "over", "about", "again", "next", "would", "should", "could", "may", "must", "its", "their", "they", "them", "our", "we", "my", "not", "yet", "just", "also", "all", "any", "some", "more", "less", "most", "one", "two", "first", "last", "out", "up", "down", "now", "sign", "wallet", "money", "plan", "plans", "step", "steps", "rate", "rates", "read", "say", "ask", "pick", "below", "above", "connect", "review", "unavailable", "sample", "none", "fee", "fees", "loan", "loans", "health", "floor", "venue", "venues", "pool", "pools", "token", "tokens", "hold", "holds", "day", "days", "week", "per", "dry", "run"];
/** Words that are English and also ordinary words of a language, so they do not count there. */
const SHARED: Readonly<Partial<Record<Locale, readonly string[]>>> = {
  tr: ["on", "an", "not", "plan", "token", "per", "son", "bu", "pool"],
  es: ["no", "me", "plan", "a", "token", "tokens", "per", "pool", "pools", "fin"],
  "pt-BR": ["no", "me", "as", "do", "a", "for", "out", "plan", "token", "tokens", "per", "pool", "pools"],
  fr: ["on", "me", "or", "an", "plan", "plans", "a", "token", "tokens", "pool", "pools", "per", "venue", "dry"],
  "zh-CN": [],
};

const OTHER_WORDS: Readonly<Record<Exclude<Locale, "en" | "zh-CN">, readonly string[]>> = {
  tr: ["ve", "bir", "için", "değil", "senin", "cüzdan", "şimdi", "sonra", "gibi", "kadar", "olarak", "yok", "var"],
  es: ["el", "los", "las", "que", "para", "con", "una", "tu", "tus", "billetera", "ahora", "puedes"],
  "pt-BR": ["você", "não", "para", "com", "uma", "seu", "sua", "carteira", "agora", "pode"],
  fr: ["vous", "votre", "vos", "les", "des", "est", "pour", "avec", "une", "portefeuille", "maintenant", "pouvez"],
};

const CJK = /[㐀-鿿豈-﫿]/u;
const TURKISH_LETTERS = /[çğışöüÇĞİŞÖÜ]/u;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
const NAMES = new RegExp(`(?<![\\p{L}])(?:${[...KEPT_NAMES].sort((a, b) => b.length - a.length).map(escape).join("|")})(?![\\p{L}])`, "gu");

/** The text with names, code, addresses, numbers and links taken out. */
export function strippedForLanguage(text: string, extraNames: readonly string[] = []): string {
  let t = text;
  for (const n of extraNames) t = t.split(n).join(" ");
  t = t.replace(/\b(?:sha256|sha3|0x):?[0-9a-f]{16,}\b|`[^`]*`|https?:\/\/\S+|(?<!\S)\/v\d\/\S*|\b[a-z]{2,6}_[A-Za-z0-9_-]{4,}\b|\b0x[0-9a-fA-F…]{3,}\b|\b[\w.-]+@[\w.-]+\b|\b\w+\.\w+\(\)|\b[a-z]+(?:[A-Z][a-z0-9]*)+\b|\b[A-Z][a-z]+\d+[A-Za-z]*\b|\b[A-Z0-9_]{2,}\b|\b[\w-]+\.(?:com|io|json|ts|md)\b/gu, " ");
  return t.replace(NAMES, " ");
}

export interface LanguageFinding {
  /** The words that gave it away. */
  readonly words: readonly string[];
  readonly text: string;
}

/** Null when the text reads as the given language (or holds no words at all); otherwise the words from another language. */
export function otherLanguageIn(text: string, locale: Locale, extraNames: readonly string[] = []): LanguageFinding | null {
  const rest = strippedForLanguage(text, extraNames);
  const words = rest.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
  if (locale === "en") {
    const hits: string[] = [];
    if (CJK.test(rest)) hits.push(...(rest.match(new RegExp(CJK.source, "gu")) ?? []).slice(0, 3));
    if (TURKISH_LETTERS.test(rest)) hits.push(...words.filter((w) => TURKISH_LETTERS.test(w)).slice(0, 3));
    for (const list of Object.values(OTHER_WORDS)) {
      const found = words.filter((w) => list.includes(w));
      if (new Set(found).size >= 2) hits.push(...found.slice(0, 3));
    }
    return hits.length > 0 ? { words: [...new Set(hits)], text } : null;
  }
  const shared = new Set(SHARED[locale] ?? []);
  const english = new Set(ENGLISH_WORDS.filter((w) => !shared.has(w)));
  const found = words.map((w) => w.replace(/[’]/gu, "'")).filter((w) => english.has(w));
  if (locale === "zh-CN") {
    // Chinese text carries no Latin sentences: three Latin words in a row, outside names, is English.
    const runs = rest.match(/[A-Za-z'’]+(?:[\s,]+[A-Za-z'’]+){2,}/gu) ?? [];
    if (runs.length > 0 || found.length > 0) return { words: [...new Set([...runs.map((r) => r.trim()), ...found])].slice(0, 6), text };
    return null;
  }
  // One clear English function word is enough in a sentence; a lone shared-looking word is not.
  return found.length > 0 ? { words: [...new Set(found)].slice(0, 6), text } : null;
}
