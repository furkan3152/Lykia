import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aliasTarget, mintSectionFor } from "../../app/routes/aliases";
import { documentTitle, matchRoute, ROUTES, type RouteId } from "../../app/routes/routeTable";
import { ACCOUNT, ADMIN, AREAS, MORE, UNLISTED, areaOf, sectionIsCurrent, tabsFor, titleOf } from "../nav";

const placed = (): RouteId[] => [
  ...AREAS.flatMap((a) => a.sections.flatMap((s) => [s.id, ...(s.also ?? [])])),
  ...ACCOUNT.map((s) => s.id),
  ...MORE.map((l) => l.id),
  ...ADMIN.map((l) => l.id),
  ...UNLISTED,
];

describe("navigation structure", () => {
  it("has at most five primary areas, in story order", () => {
    assert.ok(AREAS.length <= 5, `${AREAS.length} primary areas`);
    assert.deepEqual(AREAS.map((a) => a.id), ["ask", "flock", "fence", "herding", "mint"]);
  });

  it("places every route exactly once: an area, the account tabs, More, the team console, or deliberately unlisted", () => {
    const seen = new Set<RouteId>();
    for (const id of placed()) {
      assert.ok(!seen.has(id), `${id} is placed twice`);
      seen.add(id);
    }
    for (const id of Object.keys(ROUTES) as RouteId[]) assert.ok(seen.has(id), `${id} has no place in the navigation`);
  });

  it("keeps the secondary lists short and Letoon out of the public navigation", () => {
    assert.ok(MORE.length <= 5, `${MORE.length} entries in More`);
    assert.ok(ACCOUNT.length <= 3);
    const pub = [...AREAS.flatMap((a) => a.sections.map((s) => s.id)), ...MORE.map((l) => l.id)];
    assert.ok(!pub.includes("letoon") && !pub.includes("owner"));
    assert.deepEqual(ADMIN.map((l) => l.href), ["/letoon"]);
  });

  it("links every area and section to the page it names", () => {
    for (const area of AREAS) {
      assert.equal(area.href, area.sections[0]!.href, `${area.id} opens on its first section`);
      assert.ok(area.sections.length >= 1 && area.sections.length <= 5, `${area.id} has ${area.sections.length} sections`);
      for (const s of area.sections) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
    }
    for (const s of [...ACCOUNT, ...MORE, ...ADMIN]) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
  });

  it("leads with metaphors and always pairs them with a short plain subtitle", () => {
    assert.deepEqual(AREAS.map(titleOf), ["Ask Lyko · assistant", "Flock · portfolio", "Fence · rules", "Herding · orders and automations", "The Mint · build"]);
    for (const area of AREAS) {
      assert.ok(area.label.length <= 10, area.label);
      assert.ok(area.sub.length > 0 && area.sub.length <= 24, area.id);
      assert.ok(area.short.length > 0 && area.short.length <= 9, `${area.id}: the phone bar has one short word`);
      assert.ok(area.blurb.length > 0 && area.blurb.length <= 80, area.id);
      for (const s of area.sections) {
        assert.ok(s.label.length <= 12, s.label);
        assert.ok(s.sub.length > 0 && s.sub.length <= 20, s.label);
      }
    }
    const fence = AREAS.find((a) => a.id === "fence")!.sections.map(titleOf);
    assert.deepEqual(fence, ["Fence · rules", "Pack · agents", "Tag · agent identity", "Scent · token check", "Watch · security"]);
  });

  it("titles pages with the metaphor and its plain meaning", () => {
    for (const area of AREAS) for (const s of area.sections) assert.equal(ROUTES[s.id].title, titleOf(s), s.id);
    assert.equal(documentTitle(ROUTES.league), "The League · Lykia's cities · Lykia");
    assert.equal(ROUTES.letoon.title, "Letoon · team console");
  });

  it("finds the area and tabs for a route", () => {
    assert.equal(areaOf("outrun")?.id, "ask");
    assert.equal(areaOf("scent")?.id, "fence");
    assert.equal(areaOf("security")?.id, "fence");
    assert.equal(areaOf("whatif")?.id, "flock");
    assert.equal(areaOf("alerts")?.id, "herding");
    assert.equal(areaOf("city")?.id, "mint");
    assert.equal(areaOf("letoon"), null);
    assert.equal(areaOf("markets"), null);
    assert.equal(tabsFor("ask"), null, "Ask is one page: no tab row");
    assert.equal(tabsFor("memory"), ACCOUNT);
    assert.deepEqual(tabsFor("alerts")?.map((s) => s.id), ["orders", "automations", "alerts", "activity"]);
    const mint = AREAS.find((a) => a.id === "mint")!.sections[0]!;
    assert.ok(sectionIsCurrent(mint, "developers") && sectionIsCurrent(mint, "build"));
  });
});

describe("old addresses", () => {
  it("sends /build, its tabs and hashes, /developers and /owner to their new homes", () => {
    assert.equal(matchRoute("/build").route.id, "build");
    assert.equal(matchRoute("/mint/keys").route.id, "mint");
    assert.equal(matchRoute("/league/pay").route.id, "city");
    assert.equal(matchRoute("/letoon/flags").route.id, "letoon");
    assert.equal(aliasTarget("/build"), "/mint");
    assert.equal(aliasTarget("/developers"), "/mint");
    assert.equal(aliasTarget("/build", "#keys"), "/mint/keys");
    assert.equal(aliasTarget("/build", "#projects"), "/mint/cities");
    assert.equal(aliasTarget("/build", "#integrate"), "/mint/reference#integrate");
    assert.equal(aliasTarget("/owner"), "/letoon");
    for (const tab of ["start", "reference", "studio", "projects", "keys", "usage", "logs", "webhooks", "fee", "playground", "mcp", "sdk", "circle", "arc"]) assert.ok(mintSectionFor(tab), tab);
    assert.equal(mintSectionFor("nowhere"), null);
  });
});
