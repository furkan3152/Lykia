import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertPublicUrl, createGuardedLookup, isPublicAddress, parsePublicUrl } from "../netguard.js";

describe("SSRF guard", () => {
  it("accepts only public unicast addresses", () => {
    for (const address of ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(isPublicAddress(address), true, address);
    for (const address of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "198.18.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fd00:ec2::254",
      "fe80::1",
      "64:ff9b::7f00:1",
      "2002::1",
      "not-an-ip",
    ]) {
      assert.equal(isPublicAddress(address), false, address);
    }
  });

  it("checks URL shape without DNS", () => {
    assert.equal(parsePublicUrl("https://hooks.example.com/x").hostname, "hooks.example.com");
    assert.throws(() => parsePublicUrl("http://hooks.example.com"), { code: "INVALID_REQUEST" });
    assert.throws(() => parsePublicUrl("https://user:pw@hooks.example.com"), { code: "INVALID_REQUEST" });
    assert.throws(() => parsePublicUrl("https://hooks.example.com/#frag"), { code: "INVALID_REQUEST" });
    assert.throws(() => parsePublicUrl("https://127.0.0.1/x"), { code: "URL_FORBIDDEN" });
    assert.throws(() => parsePublicUrl("https://localhost/x"), { code: "URL_FORBIDDEN" });
    assert.throws(() => parsePublicUrl("https://svc.internal/x"), { code: "URL_FORBIDDEN" });
    assert.throws(() => parsePublicUrl("https://hooks.example.com:22/"), { code: "URL_FORBIDDEN" });
    assert.throws(() => parsePublicUrl(42), { code: "INVALID_REQUEST" });
  });

  it("refuses hosts that resolve to private addresses", async () => {
    await assertPublicUrl("https://ok.example.com", "url", async () => [{ address: "93.184.216.34", family: 4 }]);
    await assert.rejects(
      assertPublicUrl("https://rebind.example.com", "url", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ]),
      { code: "URL_FORBIDDEN" },
    );
    await assert.rejects(
      assertPublicUrl("https://nx.example.com", "url", async () => {
        throw new Error("ENOTFOUND");
      }),
      { code: "URL_UNRESOLVABLE" },
    );
  });

  it("refuses private answers at connect time (DNS rebinding)", async () => {
    const lookup = createGuardedLookup((_host, callback) => callback(null, [{ address: "169.254.169.254", family: 4 }]));
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) => lookup("evil.example.com", {}, (err) => resolve(err)));
    assert.equal(error?.code, "EURLFORBIDDEN");
    const ok = createGuardedLookup((_host, callback) => callback(null, [{ address: "1.1.1.1", family: 4 }]));
    const address = await new Promise<string>((resolve) => ok("one.example.com", {}, (_err, value) => resolve(String(value))));
    assert.equal(address, "1.1.1.1");
  });
});
