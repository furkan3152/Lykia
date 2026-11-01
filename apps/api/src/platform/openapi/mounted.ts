/** Every route mounted on an Express app, as "METHOD /path" (used by the documentation coverage test). */
import type { Express } from "express";

interface Layer {
  readonly route?: { readonly path: string | string[]; readonly methods: Record<string, boolean> };
  readonly handle?: { readonly stack?: readonly Layer[] };
}

export function mountedRoutes(app: Express, v1Prefix = "/v1"): string[] {
  const out = new Set<string>();
  const add = (layer: Layer, prefix: string) => {
    if (!layer.route) return;
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    for (const method of Object.keys(layer.route.methods)) for (const path of paths) out.add(`${method.toUpperCase()} ${prefix}${path}`);
  };
  const walk = (stack: readonly Layer[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) add(layer, prefix);
      else if (layer.handle?.stack) walk(layer.handle.stack, prefix);
    }
  };
  const root = (app as unknown as { router?: { stack: Layer[] }; _router?: { stack: Layer[] } }).router ?? (app as unknown as { _router: { stack: Layer[] } })._router;
  for (const layer of root.stack) {
    if (layer.route) add(layer, "");
    else if (layer.handle?.stack) walk(layer.handle.stack, v1Prefix);
  }
  return [...out].sort();
}
