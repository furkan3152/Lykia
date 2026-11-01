/**
 * Path patterns for the route table (pure, no DOM). Syntax, one segment each:
 *   /app/trade         literal
 *   /app/trade/:market required parameter
 *   /app/trade/:market? optional parameter (trailing segments only)
 *   /tg/*              rest: zero or more trailing segments, captured as "*"
 * Matching is case-sensitive for literals; parameters are URI-decoded and a
 * malformed escape never matches.
 */

export type RouteParams = Readonly<Record<string, string | undefined>>;

interface Segment {
  readonly kind: "literal" | "param" | "optional" | "rest";
  readonly value: string;
}

export interface CompiledPattern {
  readonly pattern: string;
  readonly segments: readonly Segment[];
}

function splitPath(path: string): string[] {
  return path.split("/").filter((part) => part.length > 0);
}

export function compilePattern(pattern: string): CompiledPattern {
  if (!pattern.startsWith("/")) throw new Error(`Route pattern must start with "/": ${pattern}`);
  const segments: Segment[] = splitPath(pattern).map((part, index, all) => {
    if (part === "*") {
      if (index !== all.length - 1) throw new Error(`"*" must be the last segment: ${pattern}`);
      return { kind: "rest", value: "*" };
    }
    if (part.startsWith(":")) {
      const optional = part.endsWith("?");
      const name = part.slice(1, optional ? -1 : undefined);
      if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(name)) throw new Error(`Invalid parameter name in ${pattern}`);
      return { kind: optional ? "optional" : "param", value: name };
    }
    return { kind: "literal", value: part };
  });
  let sawOptional = false;
  for (const segment of segments) {
    if (segment.kind === "optional") sawOptional = true;
    else if (sawOptional && segment.kind !== "rest") throw new Error(`Optional parameters must be trailing: ${pattern}`);
  }
  return { pattern, segments };
}

function decode(part: string): string | null {
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

/** Params when `pathname` matches, else null. */
export function matchPattern(compiled: CompiledPattern, pathname: string): RouteParams | null {
  const parts = splitPath(pathname);
  const params: Record<string, string | undefined> = {};
  let index = 0;
  for (const segment of compiled.segments) {
    if (segment.kind === "rest") {
      const rest = parts.slice(index).map(decode);
      if (rest.some((part) => part === null)) return null;
      params["*"] = rest.join("/");
      return params;
    }
    const part = parts[index];
    if (part === undefined) {
      if (segment.kind === "optional") {
        params[segment.value] = undefined;
        continue;
      }
      return null;
    }
    if (segment.kind === "literal") {
      if (part !== segment.value) return null;
    } else {
      const value = decode(part);
      if (value === null || value.length === 0) return null;
      params[segment.value] = value;
    }
    index += 1;
  }
  return index === parts.length ? params : null;
}

/**
 * Builds a path from a pattern: `buildPath("/app/trade/:market?", { market: "ETH" })`
 * gives "/app/trade/ETH"; a missing optional parameter drops its segment. Throws
 * when a required parameter is missing, so a broken link fails in development.
 */
export function buildPath(pattern: string, params: Readonly<Record<string, string | number | undefined>> = {}): string {
  const out: string[] = [];
  for (const segment of compilePattern(pattern).segments) {
    if (segment.kind === "literal") out.push(segment.value);
    else if (segment.kind === "rest") {
      const rest = params["*"];
      if (rest !== undefined && String(rest).length > 0) out.push(...String(rest).split("/").map(encodeURIComponent));
    } else {
      const value = params[segment.value];
      if (value === undefined || String(value).length === 0) {
        if (segment.kind === "param") throw new Error(`Missing route parameter "${segment.value}" for ${pattern}`);
        break;
      }
      out.push(encodeURIComponent(String(value)));
    }
  }
  return `/${out.join("/")}`;
}

/** Drops trailing slashes ("/app/" -> "/app"); the root stays "/". */
export function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.replace(/\/+$/u, "") || "/";
  return pathname || "/";
}
