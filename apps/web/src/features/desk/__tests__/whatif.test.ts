import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FlockHolding, FlockSnapshot } from "@lykia/core/api/flock";

import { applyShocks, exposure, shockedHealth } from "../whatif";

const h = (symbol: string, usd: string | null, where = "wallet", kind: FlockHolding["kind"] = "token"): FlockHolding => ({ symbol, token: "0x0000000000000000000000000000000000000001", amount: "1", usd, where, kind });

describe("what-if", () => {
  it("maps holdings to the asset that moves them", () => {
    assert.equal(exposure(h("cirBTC", "1")), "cirBTC");
    assert.equal(exposure(h("EURC", "1")), "EURC");
    assert.equal(exposure(h("USDC", "1")), null);
  });

  it("shocks priced holdings, keeps USDC flat, subtracts debt and skips unpriced", () => {
    const r = applyShocks([h("cirBTC", "1000"), h("USDC", "500"), h("USDC", "200", "aave", "debt"), h("MOKI", null)], { cirBTC: -50, EURC: 0 });
    assert.equal(r.before, 1300);
    assert.equal(r.after, 800);
    assert.equal(r.unpriced, 1);
    assert.equal(r.rows.find((x) => x.debt)?.after, -200);
  });

  it("scales a venue's health factor with its collateral", () => {
    const snap = { holdings: [h("cirBTC", "1000", "aave", "supply"), h("USDC", "400", "aave", "debt")], health: [{ venue: "aave", healthFactor: "2.0" }, { venue: "morpho", healthFactor: null }] } as unknown as FlockSnapshot;
    const [aave, morpho] = shockedHealth(snap, { cirBTC: -40, EURC: 0 });
    assert.equal(aave?.before, 2);
    assert.ok(Math.abs((aave?.after ?? 0) - 1.2) < 1e-9);
    assert.equal(morpho?.after, null);
  });
});
