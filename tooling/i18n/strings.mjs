/**
 * Finds the strings a person would read in a TypeScript or TSX source file:
 * JSX text, text-bearing JSX attributes, and string or template literals
 * that read as words. Shared by the hard-coded string scan (scan.mjs).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
export const ts = require("typescript");

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "scan.config.json"), "utf8"));

const BRANDS = new Set(config.brands.map((b) => b.toLowerCase()));
const ACRONYMS = new Set(config.acronyms ?? []);
const ATTRS_TEXT = new Set(config.textAttributes);
const ATTRS_SKIP = new Set(config.skipAttributes);
const SKIP_CALLS = new Set(config.skipCalls);
const SKIP_PROPS = new Set(config.skipProperties);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "dist" || name === "__tests__") continue;
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/u.test(name) && !/\.(test|d)\.ts$/u.test(name)) out.push(p);
  }
  return out;
}

export function sourceFiles(roots = config.roots) {
  return roots.flatMap((r) => walk(join(root, r))).filter((f) => {
  const rel = relative(root, f);
  return !config.skipFiles.some((s) => rel === s || rel.startsWith(s.endsWith("/") ? s : `${s}/`));
});
}

/** Does this text read as words a person would read? */
export function reads(text, inJsx) {
  const s = text.replace(/\$\{[^}]*\}/gu, " ").trim();
  if (!s) return false;
  if (!/\p{L}{2,}/u.test(s)) return false;
  if ((config.ignorePatterns ?? []).some((re) => new RegExp(re, "u").test(s))) return false;
  if (/^(https?:|mailto:|\/|#|\.\/|\.\.\/|@|0x|data:)/u.test(s)) return false;
  if (/^[A-Z0-9_]+$/u.test(s) && s.includes("_")) return false; // error codes, env names
  if (/^[\w.-]+\/[\w./-]+$/u.test(s)) return false; // paths, mime types
  if (/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/u.test(s)) return false; // dotted keys
  const words = s.split(/[\s·,:;!?()"“”'’/|+…–—-]+/u).filter((w) => /\p{L}/u.test(w));
  if (words.length === 0) return false;
  const plain = words.filter((w) => !BRANDS.has(w.toLowerCase()) && !ACRONYMS.has(w.toUpperCase()) && !/\d/u.test(w));
  if (plain.length === 0) return false;
  // Class lists, ids and other machine strings: lowercase tokens joined with dashes, colons or no spaces.
  if (!/\s/u.test(s)) {
    if (inJsx) return /^[A-Z\p{Lu}]/u.test(s) || /^\p{Ll}{3,}[.,:;!?]?$/u.test(s);
    return /^[A-Z][a-z]{2,}$/u.test(s) && !config.identifiers.includes(s);
  }
  if (s.split(/\s+/u).every((w) => /^[a-z0-9!:[\]\-_/.%&>#()=,]+$/u.test(w) && /[-:]/u.test(w))) return false; // tailwind / class lists
  if (/^[a-z-]+(\s+[a-z-]+)*$/u.test(s) && s.split(/\s+/u).every((w) => w.includes("-"))) return false;
  if (/[{};]\s*$/u.test(s) || /^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE)\s/u.test(s)) return false; // css, sql
  return true;
}

export function marked(sf, node) {
  const text = sf.getFullText();
  const start = node.getFullStart();
  const lineStart = text.lastIndexOf("\n", node.getStart(sf)) + 1;
  const lineEnd = text.indexOf("\n", node.getEnd());
  const line = text.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
  const prevLineStart = text.lastIndexOf("\n", lineStart - 2) + 1;
  const prev = text.slice(prevLineStart, lineStart);
  if (/i18n-ignore/u.test(line) || /i18n-ignore/u.test(prev) || /i18n-ignore/u.test(text.slice(start, node.getStart(sf)))) return true;
  // A marked statement, property or declaration covers everything inside it.
  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent) {
    if (ts.isStatement(p) || ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p)) {
      if (/i18n-ignore/u.test(text.slice(p.getFullStart(), p.getStart(sf)))) return true;
    }
  }
  return false;
}

export function skippedByContext(node) {
  for (let p = node.parent, child = node; p; child = p, p = p.parent) {
    if (ts.isJsxElement(p) && /^(code|pre|kbd|samp)$/u.test(p.openingElement.tagName.getText())) return true;
    if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isImportTypeNode?.(p)) return true;
    if (ts.isLiteralTypeNode(p)) return true;
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText();
      const head = callee.split(".")[0];
      if (SKIP_CALLS.has(callee) || SKIP_CALLS.has(head) || SKIP_CALLS.has(callee.split(".").pop())) return true;
    }
    if (ts.isNewExpression(p) && /Error$/u.test(p.expression.getText()) && config.errorsAreInternal) return true;
    if (ts.isJsxAttribute(p)) {
      const name = p.name.getText();
      if (ATTRS_SKIP.has(name) || name.startsWith("data-")) return true;
      return false;
    }
    if (ts.isPropertyAssignment(p) && child === p.initializer) {
      const name = p.name.getText().replace(/["']/gu, "");
      if (SKIP_PROPS.has(name)) return true;
    }
    if (ts.isPropertyAssignment(p) && child === p.name) return true;
    if (ts.isElementAccessExpression(p) && child === p.argumentExpression) return true;
    if (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/u.test(p.operatorToken.getText())) return true;
    if (ts.isCaseClause(p) && child === p.expression) return true;
    if (ts.isEnumMember(p)) return true;
  }
  return false;
}

/** Every user-facing string in the given files, with its node (for tools that rewrite it). */
export function findStrings(files) {
const findings = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  if (/^\s*\/\/\s*i18n-ignore-file/mu.test(src)) continue;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const rel = relative(root, file);
  const report = (node, text, how) => {
    if (marked(sf, node)) return;
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    findings.push({ file: rel, line: line + 1, how, text: text.replace(/\s+/gu, " ").trim().slice(0, 100), node, sf });
  };
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      const t = node.getText().trim();
      if (t && reads(t, true)) report(node, t, "jsx");
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText();
      const t = node.initializer.text;
      if (!ATTRS_SKIP.has(name) && !name.startsWith("data-") && (ATTRS_TEXT.has(name) ? reads(t, true) : reads(t, false))) report(node, t, `attr ${name}`);
    } else if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isJsxAttribute(node.parent)) {
      const inJsx = ts.isJsxExpression(node.parent);
      if (reads(node.text, inJsx) && !skippedByContext(node)) report(node, node.text, inJsx ? "jsx-expr" : "literal");
    } else if (ts.isTemplateExpression(node)) {
      const text = [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" ${} ");
      if (reads(text, false) && !skippedByContext(node)) report(node, text, "template");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
return findings;
}
