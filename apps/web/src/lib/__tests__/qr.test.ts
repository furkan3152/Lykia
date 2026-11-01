import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paymentUri, friendlyError, isAmount } from "../../features/move/model";
import { qrMatrix, qrSvgPath } from "../qr";

/** The 7×7 finder pattern at (x, y): dark ring, light ring, dark 3×3 core. */
function finderAt(m: boolean[][], x: number, y: number): boolean {
  for (let dy = 0; dy < 7; dy++)
    for (let dx = 0; dx < 7; dx++) {
      const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      if (m[y + dy]![x + dx] !== (d !== 2)) return false;
    }
  return true;
}

describe("QR encoder", () => {
  it("picks the smallest version and draws the three finder patterns", () => {
    const short = qrMatrix("hello");
    assert.equal(short.length, 21);
    const uri = qrMatrix("ethereum:0x3600000000000000000000000000000000000000@5042/transfer?address=0x82916bee18fcef517b26c72d7cb5f13694e1db41&uint256=25000000");
    assert.equal(uri.length, 49);
    for (const m of [short, uri]) {
      const n = m.length;
      assert.ok(finderAt(m, 0, 0) && finderAt(m, n - 7, 0) && finderAt(m, 0, n - 7));
      for (let i = 8; i < n - 8; i++) assert.equal(m[6]![i], i % 2 === 0, "timing pattern");
      assert.equal(m[n - 8]![8], true, "dark module");
    }
  });

  it("refuses more than version 10 holds, and draws a path with a quiet zone", () => {
    assert.throws(() => qrMatrix("x".repeat(300)));
    const { path, size } = qrSvgPath(qrMatrix("hi"));
    assert.equal(size, 29);
    assert.match(path, /^M4 4h1v1h-1z/u);
  });
});

describe("payment links", () => {
  const usdc = { symbol: "USDC", name: "USDC", decimals: 6, address: "0x3600000000000000000000000000000000000000" };
  it("builds an EIP-681 transfer with base units, or a plain address link", () => {
    assert.equal(paymentUri({ to: "0xabc", token: usdc, amount: "25.5", chainId: 5042 }), "ethereum:0x3600000000000000000000000000000000000000@5042/transfer?address=0xabc&uint256=25500000");
    assert.equal(paymentUri({ to: "0xabc", token: usdc, amount: "", chainId: 5042 }), "ethereum:0xabc@5042");
    assert.equal(isAmount("0"), false);
    assert.equal(isAmount("1,5"), false);
  });

  it("explains the beta cap and minimums plainly", () => {
    assert.match(friendlyError("Beta cap: $100 per step."), /capped per step and per day/u);
    assert.match(friendlyError("Amount is below the minimum fee."), /larger amount/u);
  });
});
