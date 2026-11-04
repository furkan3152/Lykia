import { test } from "node:test";
import assert from "node:assert/strict";
import { LeagueTransitionError, applyLeagueAction, buildProject, compareCities, isListed, leaguePublic, leagueSlug, requestListing, validateLeagueRequest } from "../dist/index.js";

const NOW = "2026-11-04T00:00:00.000Z";
const ADMIN = "0x00000000000000000000000000000000000000AD";

test("slugs are short, lowercase and start with a letter", () => {
  assert.equal(leagueSlug("Acme Pay"), "acme-pay");
  assert.equal(leagueSlug("  Caf\u00e9 -- Agents!! "), "cafe-agents");
  assert.equal(leagueSlug("42 Treasury"), "city-42-treasury");
  assert.ok(leagueSlug("x".repeat(80)).length <= 24);
  assert.equal(leagueSlug("api"), "api-city");
  assert.equal(leagueSlug("Q"), "q-app");
});

test("listing requests are validated field by field", () => {
  assert.deepEqual(validateLeagueRequest({ tagline: "Invoices that pay themselves", category: "payments" }), []);
  const paths = validateLeagueRequest({ tagline: "short", category: "casino", emblem: "dragon", slug: "admin", codename: "lower" }).map((i) => i.path);
  assert.deepEqual(paths.sort(), ["category", "codename", "emblem", "slug", "tagline"]);
});

test("a community request goes through the council and survives project updates", () => {
  const project = buildProject("prj_aaaaaaaaaaaa", "0xabc", { name: "Acme Pay" }, NOW);
  const requested = requestListing(project, { tagline: "Invoices that pay themselves", category: "payments" }, NOW);
  assert.equal(requested.status, "community");
  assert.equal(requested.review, "requested");
  assert.equal(requested.slug, "acme-pay");
  assert.equal(isListed({ league: requested }), false);
  const withLeague = { ...project, league: requested };
  const updated = buildProject(project.id, project.owner, { name: "Acme Pay 2" }, NOW, withLeague);
  assert.deepEqual(updated.league, requested, "a project update keeps the listing");

  assert.throws(() => applyLeagueAction(requested, "feature", ADMIN, NOW), LeagueTransitionError);
  const approved = applyLeagueAction(requested, "approve", ADMIN, NOW);
  assert.equal(isListed({ league: approved }), true);
  assert.equal(approved.reviewedBy, ADMIN.toLowerCase());
  const featured = applyLeagueAction(approved, "feature", ADMIN, NOW);
  assert.equal(featured.featured, true);
  const paused = applyLeagueAction(featured, "pause", ADMIN, NOW);
  assert.equal(paused.state, "paused");
  assert.throws(() => applyLeagueAction(paused, "pause", ADMIN, NOW), LeagueTransitionError);
  const delisted = applyLeagueAction(applyLeagueAction(paused, "resume", ADMIN, NOW), "delist", ADMIN, NOW);
  assert.deepEqual([delisted.listed, delisted.featured, delisted.review], [false, false, "delisted"]);
  assert.equal(applyLeagueAction(delisted, "relist", ADMIN, NOW).listed, true);
  assert.throws(() => applyLeagueAction(applyLeagueAction(requested, "reject", ADMIN, NOW), "relist", ADMIN, NOW), LeagueTransitionError);
});

test("the public view and the League order", () => {
  const base = { schema: "lykia.league/v1", listed: true, review: "approved", featured: false, emblem: "lighthouse", tagline: "A city of the League", category: "payments" };
  const view = leaguePublic({ ...base, status: "official", state: "live", slug: "pay" });
  assert.equal(view.codename, null);
  assert.deepEqual(view.does, []);
  const cities = [
    { league: { status: "community", featured: true, state: "live" }, project: { name: "Zed" } },
    { league: { status: "official", featured: false, state: "coming" }, project: { name: "Perps" } },
    { league: { status: "official", featured: false, state: "live" }, project: { name: "Pay" } },
  ].sort(compareCities);
  assert.deepEqual(cities.map((c) => c.project.name), ["Pay", "Perps", "Zed"]);
});
