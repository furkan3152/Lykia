import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clarifyAction, clarifyLabel } from "../../ask/clarify";
import { failureReasons } from "../../ask/model";
import { circleSetup, parseEntitySecret, recoveryBytes } from "../../circle/setup";
import { displayRate, rateLabel } from "../../../lib/rates";
import { modularPath, passkeyConfig, usernameProblem } from "../passkeyConfig";
import { browserWallets } from "../wallets";

describe("connect options", () => {
  it("lists EIP-6963 wallets once each and falls back to the injected provider", () => {
    const list = browserWallets(
      [
        { id: "injected", name: "Injected", type: "injected", icon: undefined },
        { id: "io.metamask", name: "MetaMask", type: "injected", icon: "data:image/svg+xml,x" },
        { id: "io.metamask.flask", name: "metamask", type: "injected", icon: undefined },
        { id: "io.rabby", name: "Rabby Wallet", type: "injected", icon: "data:," },
      ],
      true,
    );
    assert.deepEqual(list.map((w) => w.id), ["io.metamask", "io.rabby"]);
    assert.deepEqual(browserWallets([{ id: "injected", name: "Injected", type: "injected", icon: undefined }], true).map((w) => w.id), ["injected"]);
    assert.deepEqual(browserWallets([{ id: "injected", name: "Injected", type: "injected", icon: undefined }], false), []);
  });

  it("hides passkeys unless both Circle values are set, over https", () => {
    assert.equal(passkeyConfig({}), null);
    assert.equal(passkeyConfig({ VITE_CIRCLE_CLIENT_KEY: "k" }), null);
    assert.equal(passkeyConfig({ VITE_CIRCLE_CLIENT_KEY: "k", VITE_CIRCLE_CLIENT_URL: "http://x" }), null);
    assert.deepEqual(passkeyConfig({ VITE_CIRCLE_CLIENT_KEY: " k ", VITE_CIRCLE_CLIENT_URL: "https://modular.circle.com/v1/rpc/w3s/buidl/" }), { clientKey: "k", clientUrl: "https://modular.circle.com/v1/rpc/w3s/buidl" });
    assert.equal(modularPath("mainnet"), "arc");
    assert.equal(modularPath("testnet"), "arcTestnet");
    assert.equal(usernameProblem("ab"), "At least 3 characters.");
    assert.equal(usernameProblem("treasury-laptop"), null);
  });
});

describe("chat clarify and failures", () => {
  it("routes the mainnet preview and the owner console choices", () => {
    assert.deepEqual(clarifyAction("Preview on mainnet: put half my USDC to work"), { kind: "mainnet", sentence: "put half my USDC to work" });
    assert.deepEqual(clarifyAction("Deploy the practice venues from the owner console"), { kind: "owner" });
    assert.deepEqual(clarifyAction("50%"), { kind: "ask", text: "50%" });
    assert.equal(clarifyLabel("Preview on mainnet: x"), "Preview on mainnet");
  });

  it("surfaces the reasons failed tools carried", () => {
    const reasons = failureReasons({ text: "I could not build that plan.", trail: [{ label: "a", ok: false, detail: "Practice venues are not deployed on Arc testnet." }, { label: "b", ok: false, detail: "Practice venues are not deployed on Arc testnet." }, { label: "c", ok: true }] });
    assert.deepEqual(reasons, ["Practice venues are not deployed on Arc testnet."]);
  });
});

describe("circle setup and rates", () => {
  it("reads credentials from status without guessing", () => {
    assert.deepEqual(circleSetup({ credentials: { CIRCLE_API_KEY: true, CIRCLE_ENTITY_SECRET: false } }), { apiKey: "configured", entitySecret: "missing", stablefx: "unknown" });
    assert.deepEqual(circleSetup({ products: [{ needs: ["CIRCLE_API_KEY"], state: "configured" }, { needs: ["STABLEFX_API_KEY"], state: "needs-key" }] }), { apiKey: "configured", entitySecret: "unknown", stablefx: "missing" });
    assert.deepEqual(circleSetup(null), { apiKey: "unknown", entitySecret: "unknown", stablefx: "unknown" });
  });

  it("parses the entity secret answer and decodes the recovery file", () => {
    const r = parseEntitySecret({ entitySecret: "ab".repeat(32), recoveryFile: btoa("recovery!"), recoveryFileName: "recovery_file.dat" });
    assert.equal(r?.filename, "recovery_file.dat");
    assert.equal(new TextDecoder().decode(recoveryBytes(r!.recovery!)), "recovery!");
    assert.equal(parseEntitySecret({}), null);
  });

  it("labels an ECB TRY rate as a reference rate", () => {
    const rate = displayRate({ display: { TRY: "0.0241" }, displaySources: { TRY: "ecb-reference" } }, "TRY");
    assert.equal(rate?.usd, 0.0241);
    assert.match(rateLabel(rate!), /reference rate/u);
    assert.equal(displayRate({ display: { TRY: null } }, "TRY"), null);
  });
});
