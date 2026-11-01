import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { isErc6492Signature, serializeErc6492Signature, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ArcChains } from "../../chains/arc.js";
import type { PulseFeed } from "../../arc/pulse.js";
import { closeContext, createContext, type AppContext } from "../../context.js";
import { testConfig } from "../../__tests__/support.js";
import { issueNonce, verifySiwe } from "../siwe.js";

const idlePulse: PulseFeed = { latest: () => null, current: async () => null, subscribe: () => () => undefined, close: () => undefined };
const passkeyOwner = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
// A counterfactual smart account (not deployed yet) and the factory that would deploy it.
const ACCOUNT = "0x00000000000000000000000000000000c1c1e0a1" as const;
const FACTORY = "0x0000000000000000000000000000000000fac70e" as const;
const INIT = "0xdeadbeef" as Hex;

describe("SIWE with smart accounts", () => {
  let ctx: AppContext;
  const seen: { address: string; signature: Hex }[] = [];
  before(() => {
    // Stands in for Arc RPC: viem's public-client verifyMessage runs the ERC-6492 universal
    // validator in one eth_call; here we only check that the wrapped signature reaches it intact.
    const chains = {
      client: () => ({
        verifyMessage: async ({ address, signature }: { address: string; signature: Hex }) => {
          seen.push({ address, signature });
          return address.toLowerCase() === ACCOUNT.toLowerCase() && isErc6492Signature(signature);
        },
      }),
    } as unknown as ArcChains;
    ctx = createContext(testConfig({ LYKIA_SESSION_SECRET: "x".repeat(40) }), { chains, pulse: idlePulse });
  });
  after(() => closeContext(ctx));

  it("accepts an ERC-6492 wrapped signature from a counterfactual account", async () => {
    const message = (await issueNonce(ctx, { address: ACCOUNT, chainId: 5042 })).message as string;
    const inner = await passkeyOwner.signMessage({ message });
    const wrapped = serializeErc6492Signature({ address: FACTORY, data: INIT, signature: inner });
    assert.ok(wrapped.endsWith("6492649264926492649264926492649264926492649264926492649264926492"));
    const verified = await verifySiwe(ctx, message, wrapped);
    assert.equal(verified.address, ACCOUNT.toLowerCase());
    assert.equal(verified.chainId, 5042);
    assert.equal(seen.at(-1)?.signature, wrapped);
  });

  it("refuses a wrapped signature the chain does not accept", async () => {
    const other = "0x00000000000000000000000000000000000b0b0b" as const;
    const message = (await issueNonce(ctx, { address: other, chainId: 5042 })).message as string;
    const wrapped = serializeErc6492Signature({ address: FACTORY, data: INIT, signature: await passkeyOwner.signMessage({ message }) });
    await assert.rejects(verifySiwe(ctx, message, wrapped), /does not match/u);
  });
});
