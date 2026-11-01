import { test } from "node:test";
import assert from "node:assert/strict";
import { lykiaContracts } from "../dist/index.js";

const { DEPLOYABLE_ARTIFACTS, codeMatchesArtifact, stripMetadata } = lykiaContracts;

/** The artifact's runtime code with immutables filled and a different metadata hash, as a deployment built from other sources (comments, NatSpec) would carry. */
function deployedLike(name, { metadataByte = "ee", codeByte = null } = {}) {
  const artifact = DEPLOYABLE_ARTIFACTS[name];
  let body = artifact.deployedBytecode.slice(2).toLowerCase();
  for (const r of artifact.immutableReferences) body = body.slice(0, r.start * 2) + "ab".repeat(r.length) + body.slice((r.start + r.length) * 2);
  const meta = stripMetadata(`0x${body}`).length - 2;
  // Overwrite part of the 32-byte ipfs digest inside the CBOR tail.
  body = body.slice(0, meta + 22) + metadataByte.repeat(8) + body.slice(meta + 38);
  if (codeByte !== null) body = body.slice(0, 2) + codeByte + body.slice(4);
  return `0x${body}`;
}

test("stripMetadata drops solc's CBOR tail and leaves other code alone", () => {
  const code = DEPLOYABLE_ARTIFACTS.LykiaRouter.deployedBytecode;
  const stripped = stripMetadata(code);
  const tail = parseInt(code.slice(-4), 16);
  assert.equal(stripped.length, code.length - (tail + 2) * 2);
  assert.ok(code.toLowerCase().startsWith(stripped));
  assert.equal(stripMetadata("0x6000"), "0x6000");
  assert.equal(stripMetadata("0x"), "0x");
});

test("deployed code matches its artifact when only immutables and metadata differ", () => {
  for (const name of Object.keys(DEPLOYABLE_ARTIFACTS)) {
    assert.equal(codeMatchesArtifact(name, deployedLike(name)), true, name);
    assert.equal(codeMatchesArtifact(name, deployedLike(name, { codeByte: "61" })), false, `${name}: a changed opcode must not match`);
  }
  assert.equal(codeMatchesArtifact("LykiaRouter", deployedLike("LykiaOrders")), false);
  assert.equal(codeMatchesArtifact("NotAContract", "0x6000"), null);
});
