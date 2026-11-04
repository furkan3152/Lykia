import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { aliasTarget, askWith, legacyDecision, mintSectionFor } from "../../app/routes/aliases";
import { documentTitle, matchRoute, ROUTES, type RouteId } from "../../app/routes/routeTable";
import { ACCOUNT, ADMIN, AREAS, MORE, REDIRECTED, UNLISTED, areaOf, sectionIsCurrent, tabsFor, titleOf } from "../nav";

const placed = (): RouteId[] => [
  ...AREAS.flatMap((a) => a.sections.flatMap((s) => [s.id, ...(s.also ?? [])])),
  ...ACCOUNT.map((s) => s.id),
  ...MORE.map((l) => l.id),
  ...ADMIN.map((l) => l.id),
  ...REDIRECTED,
  ...UNLISTED,
];

describe("navigation structure", () => {
  it("has exactly three primary areas: the agent, the Fold and the Mint", () => {
    assert.equal(AREAS.length, 3);
    assert.deepEqual(AREAS.map((a) => a.id), ["ask", "fold", "mint"]);
    assert.deepEqual(AREAS.map((a) => a.href), ["/app", "/app/fold", "/mint"]);
    assert.deepEqual(AREAS.map((a) => a.tab), ["Ask", "Fold", "Mint"], "the phone bar reads Ask · Fold · Mint");
  });

  it("places every route exactly once: an area, Your Lyko, More, the team console, redirected or deliberately unlisted", () => {
    const seen = new Set<RouteId>();
    for (const id of placed()) {
      assert.ok(!seen.has(id), `${id} is placed twice`);
      seen.add(id);
    }
    for (const id of Object.keys(ROUTES) as RouteId[]) assert.ok(seen.has(id), `${id} has no place in the navigation`);
  });

  it("keeps manual pages for agent work out of every menu", () => {
    const menus = [...AREAS.flatMap((a) => a.sections.map((s) => s.id)), ...ACCOUNT.map((s) => s.id), ...MORE.map((l) => l.id)];
    for (const id of ["move", "orders", "alerts", "automations", "activity", "whatif", "fence", "flock", "memory"] as RouteId[]) assert.ok(!menus.includes(id), `${id} is still in a menu`);
    assert.deepEqual(ACCOUNT.map((s) => s.label), ["Your Lyko"]);
    assert.ok(MORE.length <= 5);
    assert.ok(![...menus].includes("letoon") && !menus.includes("owner"));
    assert.deepEqual(ADMIN.map((l) => l.href), ["/letoon"]);
  });

  it("links every area and section to the page it names", () => {
    for (const area of AREAS) {
      assert.equal(area.href, area.sections[0]!.href, `${area.id} opens on its first section`);
      for (const s of area.sections) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
    }
    for (const s of [...ACCOUNT, ...MORE, ...ADMIN]) assert.equal(matchRoute(s.href).route.id, s.id, s.href);
    assert.equal(matchRoute("/app").route.id, "ask");
    assert.equal(matchRoute("/app/fold").route.id, "fold");
    assert.equal(matchRoute("/app/fold/herding").route.id, "fold");
  });

  it("leads with metaphors and pairs each with a plain subtitle", () => {
    assert.deepEqual(AREAS.map(titleOf), ["Ask Lyko · your agent", "The Fold · everything you own and everything in motion", "The Mint · build"]);
    for (const area of AREAS) {
      assert.ok(area.label.length <= 10, area.label);
      assert.ok(area.short.length > 0 && area.short.length <= 12, `${area.id}: the narrow header has a short subtitle`);
      assert.ok(area.blurb.length > 0 && area.blurb.length <= 80, area.id);
      for (const s of area.sections) assert.ok(s.label.length <= 12 && s.sub.length > 0, s.label);
    }
  });

  it("titles pages with the metaphor and its plain meaning", () => {
    for (const area of AREAS) for (const s of area.sections) assert.equal(ROUTES[s.id].title, titleOf(s), s.id);
    assert.equal(documentTitle(ROUTES.league), "The League · Lykia's cities · Lykia");
    assert.equal(ROUTES.letoon.title, "Letoon · team console");
    assert.equal(ROUTES.you.title, "Your Lyko · preferences and memory");
  });

  it("finds the area and tabs for a route", () => {
    assert.equal(areaOf("outrun")?.id, "ask");
    assert.equal(areaOf("fold")?.id, "fold");
    assert.equal(areaOf("pack")?.id, "fold", "an agent's own page lives in the Fold");
    assert.equal(areaOf("scent")?.id, "fold");
    assert.equal(areaOf("city")?.id, "mint");
    assert.equal(areaOf("letoon"), null);
    assert.equal(areaOf("move"), null);
    assert.equal(tabsFor("ask"), null, "Ask is one page: no tab row");
    assert.equal(tabsFor("fold"), null, "the Fold has its own tabs inside the page");
    assert.deepEqual(tabsFor("league")?.map((s) => s.id), ["mint", "league", "ecosystem", "circle", "stats"]);
    const mint = AREAS.find((a) => a.id === "mint")!.sections[0]!;
    assert.ok(sectionIsCurrent(mint, "developers") && sectionIsCurrent(mint, "build"));
  });
});

describe("old addresses", () => {
  it("sends /build, its tabs and hashes, /developers and /owner to their new homes", () => {
    assert.equal(aliasTarget("/build"), "/mint");
    assert.equal(aliasTarget("/developers"), "/mint");
    assert.equal(aliasTarget("/build", "#keys"), "/mint/keys");
    assert.equal(aliasTarget("/build", "#integrate"), "/mint/reference#integrate");
    assert.equal(aliasTarget("/owner"), "/letoon");
    assert.equal(mintSectionFor("nowhere"), null);
  });

  it("sends manual pages to Ask Lyko with the intent filled in, or to the matching Fold tab", () => {
    assert.deepEqual(legacyDecision("move", { tab: "swap" }), { kind: "redirect", to: askWith("Convert ") });
    assert.deepEqual(legacyDecision("move", {}), { kind: "redirect", to: askWith("Pay ") });
    assert.deepEqual(legacyDecision("move", { tab: "earn" }), { kind: "redirect", to: askWith("Put my idle USDC to work") });
    const link = legacyDecision("move", { tab: "send" }, "?to=0x4100000000000000000000000000000000000009&token=EURC&amount=25");
    assert.deepEqual(link, { kind: "redirect", to: askWith("Pay 25 EURC to 0x4100000000000000000000000000000000000009") }, "a shared pay link keeps its recipient and amount");
    assert.equal(decodeURIComponent(askWith("Pay 5 USDC").split("=")[1]!), "Pay 5 USDC");
    assert.deepEqual(legacyDecision("orders", {}), { kind: "redirect", to: "/app/fold/herding?show=orders" });
    assert.deepEqual(legacyDecision("alerts", {}), { kind: "redirect", to: "/app/fold/herding?show=alerts" });
    assert.deepEqual(legacyDecision("automations", {}), { kind: "redirect", to: "/app/fold/herding?show=rounds" });
    assert.deepEqual(legacyDecision("activity", {}), { kind: "redirect", to: "/app/fold/trails" });
    assert.deepEqual(legacyDecision("whatif", {}), { kind: "redirect", to: "/app/fold/flock?whatif=1" });
    assert.deepEqual(legacyDecision("fence", {}), { kind: "redirect", to: "/app/fold/fence" });
    assert.deepEqual(legacyDecision("flock", { address: "0x82916bee18fcef517b26c72d7cb5f13694e1db41" }), { kind: "redirect", to: "/app/fold/flock?address=0x82916bee18fcef517b26c72d7cb5f13694e1db41" });
    assert.deepEqual(legacyDecision("flock", { address: "javascript:alert(1)" }), { kind: "redirect", to: "/app/fold/flock" });
    assert.deepEqual(legacyDecision("pack", {}), { kind: "redirect", to: "/app/fold/pack" });
    assert.deepEqual(legacyDecision("memory", {}), { kind: "redirect", to: "/app/you?tab=memory" });
  });

  it("keeps the form only as the edit-the-details step of a draft, and an agent's own page", () => {
    assert.deepEqual(legacyDecision("alerts", {}, "?draft=eyJ"), { kind: "page" });
    assert.deepEqual(legacyDecision("automations", {}, "?draft=eyJ"), { kind: "page" });
    assert.deepEqual(legacyDecision("fence", {}, "?edit=1"), { kind: "page" });
    assert.deepEqual(legacyDecision("pack", { id: "agt_123" }), { kind: "page" });
    assert.deepEqual(legacyDecision("move", { tab: "swap" }, "?draft=1"), { kind: "redirect", to: askWith("Convert ") }, "moving money always goes through Lyko");
    for (const id of REDIRECTED) assert.ok(matchRoute(ROUTES[id].pattern.replace(/\/:[a-z]+\?/giu, "")).route.id === id, `${id} still matches its old address`);
  });
});
