/**
 * A small, safe markdown subset for Lyko's answers (pure: node tests load it).
 *
 * Model text is untrusted, so it is never handed to the DOM as HTML. This
 * parser turns it into a tiny tree that Markdown.tsx renders with React
 * elements, which escape every string. Supported: paragraphs, "- " and
 * "1. " lists, "#" to "###" headings (drawn small), **bold**, *italics* or
 * _italics_, `inline code` and [links](https://…). On top of that, Arc
 * addresses and transaction hashes become chips, and USDC / EURC / USD
 * amounts become emphasised figures. Anything else stays plain text.
 */

export type Inline =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "strong"; readonly c: readonly Inline[] }
  | { readonly t: "em"; readonly c: readonly Inline[] }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "link"; readonly href: string; readonly c: readonly Inline[] }
  | { readonly t: "address"; readonly v: string }
  | { readonly t: "tx"; readonly v: string }
  | { readonly t: "amount"; readonly v: string; readonly unit: string };

export type Block =
  | { readonly t: "p"; readonly c: readonly Inline[] }
  | { readonly t: "h"; readonly level: 1 | 2 | 3; readonly c: readonly Inline[] }
  | { readonly t: "ul"; readonly items: readonly (readonly Inline[])[] }
  | { readonly t: "ol"; readonly start: number; readonly items: readonly (readonly Inline[])[] };

/** Links that may be followed: https/http anywhere, or a path inside the app. Everything else renders as text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^https?:\/\/[^\s<>"'`]+$/iu.test(href)) {
    try {
      const url = new URL(href);
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
    } catch {
      return null;
    }
  }
  if (/^\/(?!\/)[A-Za-z0-9_\-/?=&%.#]*$/u.test(href)) return href;
  return null;
}

const TX = /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/u;
const ADDRESS = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/u;
const AMOUNT = /(?<![\w.$])(\$\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$\s?\d+(?:\.\d+)?|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s?(?:USDC|EURC|USD|USYC|cirBTC)\b)/u;

/** Plain text with chips: addresses, tx hashes and amounts. "->" reads as an arrow. */
function decorate(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text.replace(/\s->\s/gu, " → ");
  while (rest.length > 0) {
    const hits = [
      { kind: "tx" as const, m: TX.exec(rest) },
      { kind: "address" as const, m: ADDRESS.exec(rest) },
      { kind: "amount" as const, m: AMOUNT.exec(rest) },
    ].filter((h): h is { kind: "tx" | "address" | "amount"; m: RegExpExecArray } => h.m !== null);
    if (hits.length === 0) {
      out.push({ t: "text", v: rest });
      break;
    }
    // Earliest match wins; at the same index the longer one (a tx hash before an address).
    hits.sort((a, b) => a.m.index - b.m.index || b.m[0].length - a.m[0].length);
    const { kind, m } = hits[0]!;
    if (m.index > 0) out.push({ t: "text", v: rest.slice(0, m.index) });
    if (kind === "amount") {
      const raw = m[0];
      const unit = raw.startsWith("$") ? "USD" : raw.replace(/^[\d.,\s]+/u, "");
      const v = raw.startsWith("$") ? raw.replace(/^\$\s?/u, "") : raw.slice(0, raw.length - unit.length).trim();
      out.push({ t: "amount", v, unit: raw.startsWith("$") ? "$" : unit });
    } else out.push({ t: kind, v: m[0] });
    rest = rest.slice(m.index + m[0].length);
  }
  return merge(out);
}

function merge(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.t === "text" && last?.t === "text") out[out.length - 1] = { t: "text", v: last.v + n.v };
    else if (n.t !== "text" || n.v !== "") out.push(n);
  }
  return out;
}

/** Inline markup: code first (its contents stay literal), then links, bold and italics. Unclosed markers stay text. */
export function parseInline(src: string, depth = 0): Inline[] {
  if (depth > 4) return decorate(src);
  const out: Inline[] = [];
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) out.push(...decorate(buf));
    buf = "";
  };
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === "\\" && i + 1 < src.length && /[\\`*_[\]()#-]/u.test(src[i + 1]!)) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        const v = src.slice(i + 1, end);
        out.push(TX.test(v) && v.length === 66 ? { t: "tx", v } : ADDRESS.test(v) && v.length === 42 ? { t: "address", v } : { t: "code", v });
        i = end + 1;
        continue;
      }
    }
    if (ch === "[") {
      const close = src.indexOf("]", i + 1);
      if (close > i && src[close + 1] === "(") {
        const end = src.indexOf(")", close + 2);
        if (end > close) {
          const label = src.slice(i + 1, close);
          const href = safeHref(src.slice(close + 2, end));
          flush();
          if (href) out.push({ t: "link", href, c: parseInline(label, depth + 1) });
          else out.push(...parseInline(label, depth + 1));
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === "*" && src[i + 1] === "*") {
      const end = src.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: "strong", c: parseInline(src.slice(i + 2, end), depth + 1) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " " && src[i + 1] !== undefined) {
      // "_" only opens at a word start, so snake_case and file_names stay text.
      const opens = ch === "*" || i === 0 || /[\s(]/u.test(src[i - 1]!);
      const end = opens ? findClose(src, ch, i + 1) : -1;
      if (end > i + 1) {
        flush();
        out.push({ t: "em", c: parseInline(src.slice(i + 1, end), depth + 1) });
        i = end + 1;
        continue;
      }
    }
    buf += ch;
    i += 1;
  }
  flush();
  return merge(out);
}

function findClose(src: string, ch: string, from: number): number {
  for (let j = from; j < src.length; j++) {
    if (src[j] !== ch) continue;
    if (src[j - 1] === " " || src[j + 1] === ch) continue;
    if (ch === "_" && j + 1 < src.length && /\w/u.test(src[j + 1]!)) continue;
    return j;
  }
  return -1;
}

/** Block structure: paragraphs, lists and small headings. Lines inside a paragraph join with a space. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/gu, "\n").slice(0, 20_000).split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: { kind: "ul" | "ol"; start: number; items: string[] } | null = null;
  const endPara = () => {
    if (para.length > 0) blocks.push({ t: "p", c: parseInline(para.join(" ")) });
    para = [];
  };
  const endList = () => {
    if (list) blocks.push(list.kind === "ul" ? { t: "ul", items: list.items.map((x) => parseInline(x)) } : { t: "ol", start: list.start, items: list.items.map((x) => parseInline(x)) });
    list = null;
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/u, "");
    if (line.trim() === "") {
      endPara();
      endList();
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*$/u.exec(line);
    if (heading) {
      endPara();
      endList();
      blocks.push({ t: "h", level: Math.min(3, heading[1]!.length) as 1 | 2 | 3, c: parseInline(heading[2]!) });
      continue;
    }
    const bullet = /^\s{0,6}[-*•]\s+(.*)$/u.exec(line);
    const numbered = /^\s{0,6}(\d{1,3})[.)]\s+(.*)$/u.exec(line);
    if (bullet || numbered) {
      endPara();
      const kind = bullet ? "ul" : "ol";
      if (!list || list.kind !== kind) {
        endList();
        list = { kind, start: numbered ? Number(numbered[1]) : 1, items: [] };
      }
      list.items.push(bullet ? bullet[1]! : numbered![2]!);
      continue;
    }
    if (list && /^\s{2,}\S/u.test(raw)) {
      // A continuation line of the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }
    endList();
    para.push(line.trim());
  }
  endPara();
  endList();
  return blocks;
}

/** Plain text of inline nodes (for summaries and labels). */
export function inlineText(nodes: readonly Inline[]): string {
  return nodes.map((n) => (n.t === "text" || n.t === "code" || n.t === "address" || n.t === "tx" ? n.v : n.t === "amount" ? (n.unit === "$" ? `$${n.v}` : `${n.v} ${n.unit}`) : inlineText(n.c))).join("");
}

/** The first sentence of an answer, without markup, at most `max` characters: the verdict line. */
export function firstSentence(src: string, max = 140): string {
  const blocks = parseMarkdown(src);
  const first = blocks[0];
  if (!first) return "";
  const text = (first.t === "ul" || first.t === "ol" ? inlineText(first.items[0] ?? []) : inlineText(first.c)).replace(/\s+/gu, " ").trim();
  const m = /^(.+?[.!?])(?:\s|$)/u.exec(text);
  const sentence = m ? m[1]! : text;
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence;
}

/** Text cleanups that only make sense for display. */
export function displayText(text: string): string {
  return text.replace(/;?\s*details above\.?$/iu, ".").replace(/^Sample plan \(no wallet connected, dry run\):\s*/u, "");
}
