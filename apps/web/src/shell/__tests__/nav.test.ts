import assert from "node:assert/strict";
import { encodeDraft } from "@lykia/core";
import { describe, it } from "node:test";

import { aliasTarget, askWith, legacyDecision, forgeSectionFor } from "../../app/routes/aliases";
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
  it("has exactly three primary areas: the agent, the Fold and the Forge", () => {
    assert.equal(AREAS.length, 3);
    assert.deepEqual(AREAS.map((a) => a.id), ["ask", "fold", "forge"]);
    assert.deepEqual(AREAS.map((a) => a.href), ["/app", "/app/fold", "/forge"]);
    assert.deepEqual(AREAS.map((a) => a.tab), ["Ask", "Fold", "Forge"], "the phone bar reads Ask · Fold · Forge");
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
    assert.deepEqual(AREAS.map(titleOf), ["Ask Lyko · your agent", "The Fold · everything you own and everything in motion", "The Forge · build"]);
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
    assert.equal(areaOf("pack"), null, "the old Pack page redirects to the Fold");
    assert.equal(areaOf("scent")?.id, "fold");
    assert.equal(areaOf("city")?.id, "forge");
    assert.equal(areaOf("letoon"), null);
    assert.equal(areaOf("move"), null);
    assert.equal(tabsFor("ask"), null, "Ask is one page: no tab row");
    assert.equal(tabsFor("fold"), null, "the Fold has its own tabs inside the page");
    assert.deepEqual(tabsFor("league")?.map((s) => s.id), ["forge", "league", "ecosystem", "circle", "stats"]);
    const forge = AREAS.find((a) => a.id === "forge")!.sections[0]!;
    assert.ok(sectionIsCurrent(forge, "developers") && sectionIsCurrent(forge, "build") && sectionIsCurrent(forge, "mint"));
  });
});

describe("old addresses", () => {
  it("sends /build, its tabs and hashes, /developers and /owner to their new homes", () => {
    assert.equal(aliasTarget("/build"), "/forge");
    assert.equal(aliasTarget("/developers"), "/forge");
    assert.equal(aliasTarget("/build", "#keys"), "/forge/keys");
    assert.equal(aliasTarget("/build", "#integrate"), "/forge/reference#integrate");
    assert.equal(aliasTarget("/owner"), "/letoon");
    assert.equal(forgeSectionFor("nowhere"), null);
  });

  it("redirects every /mint path to its /forge twin, with the query and hash", () => {
    assert.equal(matchRoute("/mint").route.id, "mint");
    assert.equal(matchRoute("/mint/keys").route.id, "mint");
    assert.equal(aliasTarget("/mint"), "/forge");
    assert.equal(aliasTarget("/mint/keys"), "/forge/keys");
    assert.equal(aliasTarget("/mint/reference", "#integrate"), "/forge/reference#integrate");
    assert.equal(aliasTarget("/mint/workshop", "", "?project=p_1"), "/forge/workshop?project=p_1");
    assert.equal(aliasTarget("/mint", "#keys"), "/forge#keys");
    assert.equal(ROUTES.mint.robots, "noindex,nofollow");
  });

  it("sends manual pages to Ask Lyko with the intent filled in, or to the matching Fold tab", () => {
    assert.deepEqual(legacyDecision("move", { tab: "swap" }), { kind: "redirect", to: askWith("Convert ") });
    assert.deepEqual(legacyDecision("move", {}), { kind: "redirect", to: askWith("Pay ") });
    assert.deepEqual(legacyDecision("move", { tab: "earn" }), { kind: "redirect", to: askWith("Put my idle USDC to work") });
    const link = legacyDecision("move", { tab: "send" }, "?to=0x4100000000000000000000000000000000000009&token=EURC&amount=25");
    assert.deepEqual(link, { kind: "redirect", to: askWith("Pay 25 EURC to 0x4100000000000000000000000000000000000009") }, "a shared pay link keeps its recipient and amount");
    assert.equal(decodeURIComponent(askWith("Pay 5 USDC").split("=")[1]!), "Pay 5 USDC");
    assert.deepEqual(legacyDecision("orders", {}), { kind: "redirect", to: "/app/fold/herding?show=orders" });
    assert.deepEqual(legacyDecision("alerts", {}), { kind: "redirect", to: "/app/fold/herding?show=watches" });
    assert.deepEqual(legacyDecision("automations", {}), { kind: "redirect", to: "/app/fold/herding?show=automations" });
    assert.deepEqual(legacyDecision("activity", {}), { kind: "redirect", to: "/app/fold/trails" });
    assert.deepEqual(legacyDecision("whatif", {}), { kind: "redirect", to: "/app/fold/flock?whatif=1" });
    assert.deepEqual(legacyDecision("fence", {}), { kind: "redirect", to: "/app/fold/fence" });
    assert.deepEqual(legacyDecision("flock", { address: "0x82916bee18fcef517b26c72d7cb5f13694e1db41" }), { kind: "redirect", to: "/app/fold/flock?address=0x82916bee18fcef517b26c72d7cb5f13694e1db41" });
    assert.deepEqual(legacyDecision("flock", { address: "javascript:alert(1)" }), { kind: "redirect", to: "/app/fold/flock" });
    assert.deepEqual(legacyDecision("pack", {}), { kind: "redirect", to: "/app/fold/pack" });
    assert.deepEqual(legacyDecision("memory", {}), { kind: "redirect", to: "/app/you?tab=memory" });
  });

  it("retires every form page: drafts and edits open Ask Lyko, and the pages that became answers ask their question", () => {
    const alertDraft = `?draft=${encodeDraft({ kind: "price-below", token: "EURC", threshold: "1.05", channels: ["telegram"] })}`;
    assert.deepEqual(legacyDecision("alerts", {}, alertDraft), { kind: "redirect", to: askWith("Watch EURC below $1.05 and tell me on Telegram") });
    const autoDraft = `?draft=${encodeDraft({ name: "Friday sweep", trigger: { type: "schedule", every: "week", weekday: "fri", at: "17:00", timezone: "UTC" }, action: { type: "plan", sentence: "keep 1 USDC liquid and earn the rest" } })}`;
    const auto = legacyDecision("automations", {}, autoDraft);
    assert.match(decodeURIComponent(auto.to), /keep 1 USDC liquid and earn the rest$/u);
    assert.deepEqual(legacyDecision("automations", {}, "?draft=eyJ"), { kind: "redirect", to: askWith("Every ") }, "a draft that does not decode still lands in Ask");
    assert.deepEqual(legacyDecision("orders", {}, "?edit=0xabc"), { kind: "redirect", to: askWith("Change my order 0xabc: ") });
    assert.deepEqual(legacyDecision("fence", {}, "?edit=1"), { kind: "redirect", to: askWith("Change my Fence: ") });
    assert.deepEqual(legacyDecision("pack", { id: "agt_123" }), { kind: "redirect", to: "/app/fold/pack" });
    assert.deepEqual(legacyDecision("security", {}), { kind: "redirect", to: "/app/fold/fence#safety" });
    assert.deepEqual(legacyDecision("pastures", {}), { kind: "redirect", to: askWith("Where can I earn on USDC?") });
    assert.deepEqual(legacyDecision("discover", {}), { kind: "redirect", to: askWith("What are the new pools on Arc?") });
    assert.deepEqual(legacyDecision("markets", {}), { kind: "redirect", to: askWith("Show me the perps markets") });
    assert.deepEqual(legacyDecision("move", { tab: "swap" }, "?draft=1"), { kind: "redirect", to: askWith("Convert ") }, "moving money always goes through Lyko");
    for (const id of REDIRECTED) assert.ok(matchRoute(ROUTES[id].pattern.replace(/\/:[a-z]+\?/giu, "")).route.id === id, `${id} still matches its old address`);
  });
});

describe("the top menu: three Mosaic tiles, no visible subtitles", () => {
  const visibleText = (html: string) =>
    html
      .replace(/<svg[\s\S]*?<\/svg>/gu, "")
      .replace(/<[^>]+>/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();

  it("has three tiles whose visible text is the name alone; the plain word rides in the accessible name", async () => {
    const React = (await import("react")).default;
    const { renderToStaticMarkup } = await import("react-dom/server");
    (globalThis as { React?: unknown }).React = React;
    const { NavTileBody } = await import("../NavTile");
    const { navTileText } = await import("../nav");
    assert.equal(AREAS.length, 3);
    for (const area of AREAS) {
      const text = navTileText(area, 0);
      assert.equal(text.visible, area.label);
      assert.ok(text.ariaLabel.includes(area.sub) && text.title.includes(area.sub), `${area.id}: the subtitle stays available to assistive tech`);
      for (const short of [false, true]) {
        const shown = visibleText(renderToStaticMarkup(React.createElement(NavTileBody, { area, short })));
        assert.equal(shown, short ? area.tab : area.label, `${area.id}${short ? " (phone)" : ""}`);
        assert.ok(!shown.toLowerCase().includes(area.sub.toLowerCase()) && !shown.toLowerCase().includes(area.short.toLowerCase()), `${area.id}: no visible subtitle`);
      }
    }
    assert.equal(navTileText(AREAS[1]!, 3).ariaLabel, "The Fold, everything you own and everything in motion, 3 new from Lyko");
    const badge = visibleText(renderToStaticMarkup(React.createElement(NavTileBody, { area: AREAS[1]!, badge: 12, short: true })));
    assert.equal(badge, "9+ Fold", "the Fold keeps Lyko's badge");
  });

  it("draws each tile's icon from squares, every row the same width", async () => {
    const { STEP_ART, MARK_ART, INTENT_ART, INTENT_PAL } = await import("../../mosaic/pixelArtData");
    for (const [name, art] of Object.entries(INTENT_ART)) {
      assert.ok(art.every((row) => [...row].every((ch) => ch === "." || ch in INTENT_PAL)), `${name} uses a colour outside its palette`);
    }
    for (const [name, art] of Object.entries({ ...STEP_ART, ...MARK_ART, ...INTENT_ART })) {
      assert.ok(art.every((row) => row.length === art[0]!.length), `${name} rows differ in width`);
    }
  });

  it("renders the shell's menus through the tiles, with no subtitle spans left", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["Header.tsx", "MobileTabs.tsx"]) {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.ok(src.includes("NavTileBody"), file);
      assert.ok(!/area\.(sub|short)\}/u.test(src) && !/m-nav__s|m-tabsbar__s/u.test(src), `${file} still shows a subtitle`);
    }
  });
});
