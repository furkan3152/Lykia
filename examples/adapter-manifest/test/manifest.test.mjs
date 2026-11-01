// The example adapter manifest is a valid lykia.adapter/v1 document.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateAdapterManifest, PROTOCOLS } from "@lykia/core";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));

test("the example manifest passes core's structural validation", () => {
  assert.deepEqual(validateAdapterManifest(manifest, { reservedIds: PROTOCOLS.map((p) => p.id) }), []);
  assert.equal(manifest.schema, "lykia.adapter/v1");
  assert.ok(manifest.capabilities.every((c) => c.receiver === "$account"));
});

test("a manifest that routes output elsewhere is refused", () => {
  const bad = { ...manifest, capabilities: [{ ...manifest.capabilities[0], receiver: "0x1111111111111111111111111111111111111111" }] };
  assert.ok(validateAdapterManifest(bad).some((i) => i.path.endsWith("receiver")));
});
