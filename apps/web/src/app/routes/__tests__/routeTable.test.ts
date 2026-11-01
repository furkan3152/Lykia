import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPath, compilePattern, matchPattern, normalizePathname } from "../matchPath";
import { documentTitle, matchRoute, robotsFor, routeHref, ROUTES } from "../routeTable";

describe("matchPattern", () => {
  it("matches literals and decodes parameters", () => {
    assert.deepEqual(matchPattern(compilePattern("/app/fence"), "/app/fence"), {});
    assert.equal(matchPattern(compilePattern("/app/fence"), "/app/fence/x"), null);
    const optional = compilePattern("/app/scent/:token?");
    assert.deepEqual(matchPattern(optional, "/app/scent"), { token: undefined });
    assert.deepEqual(matchPattern(optional, "/app/scent/0xabc"), { token: "0xabc" });
  });

  it("normalises and builds paths", () => {
    assert.equal(normalizePathname("/app/flock/"), "/app/flock");
    assert.equal(buildPath("/app/kunye/:agentId?", { agentId: "12" }), "/app/kunye/12");
  });
});

describe("route table", () => {
  it("matches every Lykia page", () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ["/", "landing"],
      ["/developers", "developers"],
      ["/lykaion", "lykaion"],
      ["/app", "deck"],
      ["/app/flock", "flock"],
      ["/app/flock/0x1111111111111111111111111111111111111111", "flock"],
      ["/app/fence", "fence"],
      ["/app/kunye/7", "kunye"],
      ["/app/scent/0xabc", "scent"],
      ["/app/outrun/out_1", "outrun"],
      ["/flock", "toFlock"],
      ["/scent/0xabc", "toScent"],
      ["/app/nowhere", "appNotFound"],
      ["/nowhere", "notFound"],
    ];
    for (const [path, id] of cases) assert.equal(matchRoute(path).route.id, id, path);
  });

  it("keeps the brand out of Arc's name and titles pages", () => {
    assert.match(ROUTES.landing.title, /^Lykia/u);
    assert.equal(documentTitle(ROUTES.fence), "Fence · Lykia");
    assert.equal(routeHref("scent", { token: "0x1" }), "/app/scent/0x1");
    assert.equal(robotsFor(ROUTES.lykaion), "noindex,nofollow");
    for (const route of Object.values(ROUTES)) assert.doesNotMatch(route.title, /\bArc\b/u, route.id);
  });
});
