import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApiError, describeError, errorFromResponse, parseRetryAfter } from "../apiErrors";
import { hexWeiToGwei } from "../arcRpc";
import { DEFAULT_API_URL, resolveApiBase } from "../config";

describe("API client errors", () => {
  it("parses the Lykia error envelope", () => {
    const error = errorFromResponse(403, { error: { code: "FENCE_DENIED", message: "The Fence denies this plan.", requestId: "r1" } });
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "FENCE_DENIED");
    assert.equal(error.status, 403);
    assert.equal(describeError(error), "The Fence denies this plan.");
  });

  it("falls back for non-envelope bodies and reads Retry-After", () => {
    const error = errorFromResponse(502, "<html>bad gateway</html>");
    assert.equal(error.status, 502);
    assert.equal(parseRetryAfter("5", 0), 5000);
  });

  it("prefers wallet short messages", () => {
    assert.equal(describeError({ shortMessage: "User rejected the request." }), "User rejected the request.");
    assert.equal(describeError(42), "Something went wrong.");
  });
});

describe("config and RPC helpers", () => {
  it("accepts origins only", () => {
    assert.equal(resolveApiBase("").base, DEFAULT_API_URL);
    assert.equal(DEFAULT_API_URL, "http://localhost:3002");
    assert.equal(resolveApiBase("https://api.lykia.example").base, "https://api.lykia.example");
    assert.ok(resolveApiBase("https://x.example/v1").warning);
  });

  it("converts hex wei to gwei", () => {
    assert.equal(hexWeiToGwei("0x4a817c800"), "20");
    assert.equal(hexWeiToGwei("0x4a8a0a1c0"), "20.008");
  });
});
