/**
 * The hard-coded string scan. It reads every source file of the web app
 * and the API's owner-facing builders with the TypeScript parser and fails
 * on a string a person would read that does not come from a catalogue:
 * JSX text, text-bearing JSX attributes, and string or template literals
 * that read as English words.
 *
 * Skipped: tests, the catalogues themselves, imports, `t("key")` and other
 * catalogue lookups, class names, URLs and paths, error codes, log lines
 * (console.*, logger.*), and anything on a line or in a node marked
 * `i18n-ignore` (with the reason next to it). Brand, token and chain names
 * are allowed on their own.
 *
 *   node tooling/i18n/scan.mjs            scan, exit 1 on findings
 *   node tooling/i18n/scan.mjs --list     print every finding
 *   node tooling/i18n/scan.mjs --count    findings per file
 */
import { findStrings, sourceFiles } from "./strings.mjs";

const files = sourceFiles();
const findings = findStrings(files);

const args = new Set(process.argv.slice(2));
if (args.has("--count")) {
  const by = new Map();
  for (const f of findings) by.set(f.file, (by.get(f.file) ?? 0) + 1);
  for (const [f, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${f}`);
}
if (args.has("--list")) for (const f of findings) console.log(`${f.file}:${f.line}  [${f.how}]  ${f.text}`);
console.log(`${findings.length === 0 ? "Hard-coded string scan passed" : `Hard-coded string scan: ${findings.length} user-facing string${findings.length === 1 ? "" : "s"} outside the catalogues`} · ${files.length} files`);
process.exit(findings.length === 0 ? 0 : 1);
