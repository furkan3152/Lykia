import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cityUrl, detectCity, lykiaHome } from "../detect";

const at = (hostname: string, pathname = "/", search = "") => ({ hostname, pathname, search });

describe("city mode", () => {
  it("reads <slug>.<root domain>", () => {
    assert.deepEqual(detectCity(at("pay.lykia.app"), "lykia.app"), { kind: "slug", slug: "pay", via: "subdomain" });
    assert.deepEqual(detectCity(at("agents.lykia.app", "/anything"), "lykia.app"), { kind: "slug", slug: "agents", via: "subdomain" });
    assert.equal(detectCity(at("lykia.app"), "lykia.app"), null, "the root is the full app");
    for (const own of ["www", "api", "app", "admin", "letoon", "mint"]) assert.equal(detectCity(at(`${own}.lykia.app`), "lykia.app"), null, own);
    assert.equal(detectCity(at("a.b.lykia.app"), "lykia.app"), null);
    assert.equal(detectCity(at("pay.lykia.app"), null), null, "no root domain configured");
  });

  it("reads /c/<slug> and ?city=<slug> on any host, so it works before a domain exists", () => {
    assert.deepEqual(detectCity(at("lykia-akdogan1.vercel.app", "/c/pay"), null), { kind: "slug", slug: "pay", via: "path" });
    assert.deepEqual(detectCity(at("lykia-akdogan1.vercel.app", "/c/agents/home"), null), { kind: "slug", slug: "agents", via: "path" });
    assert.deepEqual(detectCity(at("localhost", "/", "?city=perps"), null), { kind: "slug", slug: "perps", via: "query" });
    assert.equal(detectCity(at("localhost", "/c/X"), null), null);
    assert.equal(detectCity(at("localhost", "/league/pay"), null), null);
    assert.equal(detectCity(at("lykia-akdogan1.vercel.app"), "lykia.app"), null, "vercel hosts boot the full app");
  });

  it("maps a verified custom domain to its city once a root domain is set", () => {
    assert.deepEqual(detectCity(at("pay.acme.example"), "lykia.app"), { kind: "host", host: "pay.acme.example" });
    assert.equal(detectCity(at("localhost"), "lykia.app"), null);
  });

  it("builds city and home links", () => {
    assert.equal(cityUrl("pay", "lykia.app", "https://x.vercel.app"), "https://pay.lykia.app");
    assert.equal(cityUrl("pay", null, "https://x.vercel.app"), "https://x.vercel.app/c/pay");
    assert.equal(lykiaHome("lykia.app", "https://pay.lykia.app", { kind: "slug", slug: "pay", via: "subdomain" }), "https://lykia.app");
    assert.equal(lykiaHome(null, "https://x.vercel.app", { kind: "slug", slug: "pay", via: "path" }), "https://x.vercel.app");
  });
});
