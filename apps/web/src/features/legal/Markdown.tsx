/**
 * A tiny Markdown renderer for the repository's own documents (headings,
 * paragraphs, lists, tables, quotes, code blocks, **bold**, `code`, links).
 * It renders trusted, bundled text only and never injects HTML.
 */
import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)]+)/gu;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const t = m[0];
    const key = `${keyBase}-${i++}`;
    if (t.startsWith("**")) out.push(<b key={key}>{t.slice(2, -2)}</b>);
    else if (t.startsWith("`")) out.push(<code key={key} className="mono">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const [, label = "", href = ""] = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(t) ?? [];
      out.push(/^https?:\/\//u.test(href) ? <a key={key} href={href} target="_blank" rel="noreferrer noopener">{label}</a> : <span key={key}>{label}</span>);
    } else out.push(<a key={key} href={t} target="_blank" rel="noreferrer noopener">{t}</a>);
    last = at + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { readonly source: string }) {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const key = `b${k++}`;
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) body.push(lines[i++]!);
      i++;
      blocks.push(<pre key={key} className="m-code" style={{ whiteSpace: "pre-wrap" }}>{body.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/u.exec(line);
    if (h) {
      const level = h[1]!.length;
      const text = inline(h[2]!, key);
      blocks.push(level === 1 ? <h1 key={key} className="m-h2">{text}</h1> : level === 2 ? <h2 key={key} style={{ fontSize: 22, marginTop: 18 }}>{text}</h2> : <h3 key={key} style={{ fontSize: 18, marginTop: 12 }}>{text}</h3>);
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith(">")) body.push(lines[i++]!.replace(/^>\s?/u, ""));
      blocks.push(<p key={key} className="m-note">{inline(body.join(" "), key)}</p>);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i]!.startsWith("|")) {
        const cells = lines[i++]!.split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-{3,}:?$/u.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      blocks.push(
        <div key={key} style={{ overflowX: "auto" }}>
          <table className="m-table">
            {head ? <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `${key}h${j}`)}</th>)}</tr></thead> : null}
            <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{inline(c, `${key}r${ri}c${j}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*[-*]\s+/u.test(line) || /^\s*\d+\.\s+/u.test(line)) {
      const ordered = /^\s*\d+\./u.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && !lines[i]!.startsWith("#") && !lines[i]!.startsWith("|")) {
        const l = lines[i++]!;
        if (/^\s*([-*]|\d+\.)\s+/u.test(l)) items.push(l.replace(/^\s*([-*]|\d+\.)\s+/u, ""));
        else if (items.length > 0) items[items.length - 1] += ` ${l.trim()}`;
      }
      const lis = items.map((t, j) => <li key={j}>{inline(t, `${key}l${j}`)}</li>);
      blocks.push(ordered ? <ol key={key} className="m-small" style={{ paddingLeft: 20, display: "grid", gap: 6 }}>{lis}</ol> : <ul key={key} className="m-small" style={{ paddingLeft: 20, display: "grid", gap: 6, listStyle: "square" }}>{lis}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "" && !/^(#|>|\||```|\s*[-*]\s|\s*\d+\.\s)/u.test(lines[i]!)) para.push(lines[i++]!.trim());
    blocks.push(<p key={key} className="m-small">{inline(para.join(" "), key)}</p>);
  }
  return <div className="m-doc" style={{ display: "grid", gap: 10 }}>{blocks}</div>;
}
