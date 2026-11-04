import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { matchRoute, ROUTES, type RouteId } from "../../app/routes/routeTable";
import { ACCOUNT, AREAS, MORE, UNLISTED, areaOf, sectionIsCurrent, tabsFor } from "../nav";

const placed = (): RouteId[] => [
  ...AREAS.flatMap((a) => a.sections.flatMap((s) => [s.id, ...(s.also ?? [])])),
  ...ACCOUNT.map((s) => s.id),
  ...MORE.map((l) => l.id),
  ...UNLISTED,
];

describe("navigation structure", () => {
  it("has at most five primary areas, in story order", () => {
    assert.ok(AREAS.length <= 5, `${AREAS.length} primary areas`);
    assert.deepEqual(AREAS.map((a) => a.id), ["ask", "portfolio", "rules", "automate", "build"]);
  });

  it("places every route exactly once: an area, the account tabs, More, or deliberately unlisted", () => {
    const all = placed();
    const seen = new Set<RouteId>();
    for (const id of all) {
      assert.ok(!seen.has(id), `${id} is placed twice`);
      seen.add(id);
    }
    for (const id of Object.keys(ROUTES) as RouteId[]) assert.ok(seen.has(id), `${id} has no place in the navigation`);
  });

  it("keeps the secondary list short", () => {
    assert.ok(MORE.length <= 5, `${MORE.length} entries in More`);
    assert.ok(ACCOUNT.length <= 3);
  });

  it("links every area and section to the page it names", () => {
    for (const area of AREAS) {
      assert.equal(area.href, area.sections[0]!.href, `${area.id} opens on its first section`);
      assert.ok(area.sections.length >= 1 && area.sections.length <= 5, `${area.id} has ${area.sections.length} sections`);
      for (const s of area.sections) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
    }
    for (const s of ACCOUNT) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
    for (const l of MORE) assert.equal(matchRoute(l.href).route.id, l.id, l.href);
  });

  it("uses plain labels for primary areas and sections", () => {
    const lore = /\b(?:flock|pack|scent|pastures?|outrun|fold|whistle|desk|pups?)\b/iu;
    for (const area of AREAS) {
      assert.doesNotMatch(area.label, lore, area.label);
      assert.ok(area.label.length <= 10, area.label);
      assert.ok(area.blurb.length > 0 && area.blurb.length <= 80, area.id);
      for (const s of area.sections) {
        assert.doesNotMatch(s.label, lore, s.label);
        assert.ok(s.label.length <= 12, s.label);
      }
    }
  });

  it("finds the area and tabs for a route", () => {
    assert.equal(areaOf("outrun")?.id, "ask");
    assert.equal(areaOf("scent")?.id, "rules");
    assert.equal(areaOf("security")?.id, "rules");
    assert.equal(areaOf("whatif")?.id, "portfolio");
    assert.equal(areaOf("alerts")?.id, "automate");
    assert.equal(areaOf("stats")?.id, "build");
    assert.equal(areaOf("markets"), null);
    assert.equal(tabsFor("ask"), null, "Ask is one page: no tab row");
    assert.equal(tabsFor("markets"), null);
    assert.equal(tabsFor("memory"), ACCOUNT);
    assert.deepEqual(tabsFor("alerts")?.map((s) => s.id), ["orders", "automations", "alerts", "activity"]);
    const developers = AREAS.find((a) => a.id === "build")!.sections[0]!;
    assert.ok(sectionIsCurrent(developers, "developers"));
  });
});
